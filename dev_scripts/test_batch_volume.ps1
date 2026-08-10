# test_batch_volume.ps1
#
# Batch volume stress test. Duplicates tests\label1_image.png and
# label2_image.png up to $TargetCount total items (default 50) and
# submits them all together in ONE real /api/verify/batch request,
# timing it and confirming every item completes.
#
# This tests THROUGHPUT AND STABILITY at volume (does the sequential
# loop in services/batch.ts hold up, does the request complete
# cleanly, how long does it actually take), NOT extraction accuracy
# across 50 unique real labels, there are only 2 real labels here,
# duplicated. See REQUIREMENTS_MATCH.md for the honest distinction
# and why full 200-300 volume wasn't run (real API cost, no employer
# funding an unpaid take-home's OpenAI bill).
#
# Costs real money: $TargetCount real OpenAI vision API calls against
# whatever OPENAI_API_KEY is configured. Default is intentionally 50,
# not higher, raise $TargetCount only if you're deliberately choosing
# to spend more.

Add-Type -AssemblyName System.Net.Http

$uri = "http://localhost:3002/api/verify/batch"
$healthUri = "http://localhost:3002/api/health"
$testsDir = Join-Path $PSScriptRoot "..\tests"
$TargetCount = 50

Write-Host "Checking backend at $healthUri ..."
try {
    $healthClient = New-Object System.Net.Http.HttpClient
    $healthClient.Timeout = [TimeSpan]::FromSeconds(5)
    $healthResponse = $healthClient.GetAsync($healthUri).GetAwaiter().GetResult()
    $healthClient.Dispose()
    if (-not $healthResponse.IsSuccessStatusCode) {
        Write-Host "ERROR: backend not healthy." -ForegroundColor Red
        exit 1
    }
    Write-Host "Backend is up." -ForegroundColor Green
}
catch {
    Write-Host "ERROR: backend not reachable. Is it running? (run_back.bat)" -ForegroundColor Red
    exit 1
}

function Read-ApplicationDataFields {
    param([string]$Path)
    $fields = @{}
    foreach ($line in Get-Content -Path $Path) {
        if ($line.Trim() -eq "") { break }
        if ($line -match '^([A-Za-z]+):\s*(.*)$') {
            $key = $Matches[1]
            $value = $Matches[2].Trim()
            if ($value -and -not $value.StartsWith("(")) {
                $fields[$key] = $value
            }
        }
    }
    return $fields
}

$sourcePairs = @(
    [pscustomobject]@{ Image = Join-Path $testsDir "label1_image.png"; Fields = Read-ApplicationDataFields -Path (Join-Path $testsDir "label1_text.txt") },
    [pscustomobject]@{ Image = Join-Path $testsDir "label2_image.png"; Fields = Read-ApplicationDataFields -Path (Join-Path $testsDir "label2_text.txt") }
)

# Build $TargetCount items by cycling through the source pairs.
$items = @()
for ($i = 0; $i -lt $TargetCount; $i++) {
    $items += $sourcePairs[$i % $sourcePairs.Count]
}

Write-Host ""
Write-Host "============================================================"
Write-Host (" Submitting {0} items in ONE batch request (label1/label2 cycled)" -f $items.Count)
Write-Host " This costs real OpenAI API usage. Ctrl+C now to cancel."
Write-Host "============================================================"
Start-Sleep -Seconds 3

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromMinutes(20)
$content = New-Object System.Net.Http.MultipartFormDataContent

foreach ($item in $items) {
    $imageBytes = [System.IO.File]::ReadAllBytes($item.Image)
    $imageContent = New-Object System.Net.Http.ByteArrayContent(, $imageBytes)
    $imageContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("image/png")
    $content.Add($imageContent, "labelImages", [System.IO.Path]::GetFileName($item.Image))
}

$applicationsJsonParts = $items | ForEach-Object { $_.Fields | ConvertTo-Json -Depth 5 -Compress }
$applicationsJson = "[" + ($applicationsJsonParts -join ",") + "]"
$content.Add((New-Object System.Net.Http.StringContent($applicationsJson)), "applications")

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$estMinSec = 2.0 * $items.Count
$estMaxSec = 3.5 * $items.Count
Write-Host ""
Write-Host "Request sent. The backend processes items sequentially" -ForegroundColor Cyan
Write-Host "(no concurrency yet, see REQUIREMENTS_MATCH.md), so this will" -ForegroundColor Cyan
Write-Host ("take roughly {0:N0}-{1:N0} seconds for {2} items. Printing elapsed" -f $estMinSec, $estMaxSec, $items.Count) -ForegroundColor Cyan
Write-Host "time every 5s below so this doesn't look frozen while it works." -ForegroundColor Cyan
Write-Host ""

try {
    $task = $client.PostAsync($uri, $content)
    while (-not $task.IsCompleted) {
        Start-Sleep -Seconds 5
        Write-Host ("  ... still working, {0:N0}s elapsed" -f $sw.Elapsed.TotalSeconds)
    }
    $response = $task.GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
}
catch {
    $sw.Stop()
    Write-Host ("REQUEST FAILED after {0:N1}s" -f $sw.Elapsed.TotalSeconds) -ForegroundColor Red
    Write-Host "Full exception chain (innermost is the real cause):" -ForegroundColor Red
    $ex = $_.Exception
    $depth = 0
    while ($ex -ne $null) {
        Write-Host ("  [{0}] {1}: {2}" -f $depth, $ex.GetType().Name, $ex.Message) -ForegroundColor Red
        $ex = $ex.InnerException
        $depth++
    }
    $client.Dispose()
    exit 1
}
$sw.Stop()
$client.Dispose()

Write-Host ""
Write-Host ("HTTP {0}, total time {1:N1}s ({2:N1} min)" -f [int]$response.StatusCode, $sw.Elapsed.TotalSeconds, $sw.Elapsed.TotalMinutes)

if (-not $response.IsSuccessStatusCode) {
    Write-Host "REQUEST FAILED:" -ForegroundColor Red
    Write-Host $body -ForegroundColor Red
    exit 1
}

$parsed = $body | ConvertFrom-Json
$okCount = ($parsed.results | Where-Object { $_.ok -eq $true }).Count
$failCount = ($parsed.results | Where-Object { $_.ok -ne $true }).Count
$avgPerItem = $sw.Elapsed.TotalSeconds / $items.Count

Write-Host ""
Write-Host "============================================================"
Write-Host (" Results: {0}/{1} items processed (ok)" -f $okCount, $items.Count)
Write-Host (" Failed:  {0}" -f $failCount)
Write-Host (" Total time: {0:N1}s ({1:N1} min)" -f $sw.Elapsed.TotalSeconds, $sw.Elapsed.TotalMinutes)
Write-Host (" Average per item: {0:N2}s" -f $avgPerItem)
Write-Host "============================================================"

if ($failCount -gt 0) {
    Write-Host ""
    Write-Host "Failed items:" -ForegroundColor Yellow
    foreach ($item in $parsed.results | Where-Object { $_.ok -ne $true }) {
        Write-Host ("  index {0}: {1}" -f $item.index, $item.error) -ForegroundColor Yellow
    }
}
