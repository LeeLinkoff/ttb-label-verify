# debug_verify_label1_loop.ps1
#
# Runs /api/verify against tests\label1_image.png N times (default
# 15), printing a one-line summary for every run, and the FULL
# field-by-field breakdown only for any run that comes back
# overallMatch: False. Built to catch and diagnose the intermittent
# failure seen in benchmark_verify.ps1 (9/10 True, 1/10 False on
# label1, no per-field detail available from that script).
#
# label1 is expected to be True on every run, it's the fully
# compliant label. Any False here is worth capturing in full.

Add-Type -AssemblyName System.Net.Http

$uri = "http://localhost:3002/api/verify"
$healthUri = "http://localhost:3002/api/health"
$testsDir = Join-Path $PSScriptRoot "..\tests"
$imagePath = Join-Path $testsDir "label1_image.png"
$textPath = Join-Path $testsDir "label1_text.txt"
$Runs = 15

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
}
catch {
    Write-Host "ERROR: backend not reachable." -ForegroundColor Red
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

$fields = Read-ApplicationDataFields -Path $textPath

Write-Host "Running $Runs requests against label1 (expected: True every time)..."
Write-Host ""

$failureCount = 0

for ($i = 1; $i -le $Runs; $i++) {
    $client = New-Object System.Net.Http.HttpClient
    $content = New-Object System.Net.Http.MultipartFormDataContent

    $imageBytes = [System.IO.File]::ReadAllBytes($imagePath)
    $imageContent = New-Object System.Net.Http.ByteArrayContent(, $imageBytes)
    $imageContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("image/png")
    $content.Add($imageContent, "labelImage", "label1_image.png")

    foreach ($key in $fields.Keys) {
        $content.Add((New-Object System.Net.Http.StringContent($fields[$key])), $key)
    }

    try {
        $response = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
    catch {
        Write-Host ("Run {0,2}: CONNECTION FAILED" -f $i) -ForegroundColor Red
        $client.Dispose()
        continue
    }
    $client.Dispose()

    $parsed = $body | ConvertFrom-Json

    if ($parsed.overallMatch -eq $true) {
        Write-Host ("Run {0,2}: True" -f $i) -ForegroundColor Green
    } else {
        $failureCount++
        Write-Host ("Run {0,2}: FALSE  <-- full detail below" -f $i) -ForegroundColor Red
        Write-Host "------------------------------------------------------------"
        foreach ($fieldName in $parsed.fields.PSObject.Properties.Name) {
            $f = $parsed.fields.$fieldName
            $color = if ($f.match) { "Gray" } else { "Yellow" }
            Write-Host ("  {0,-16} match={1,-5} extracted=[{2}]  applied=[{3}]" -f $fieldName, $f.match, $f.extracted, $f.applied) -ForegroundColor $color
        }
        Write-Host "------------------------------------------------------------"
        Write-Host ""
    }
}

Write-Host ""
Write-Host "============================================================"
Write-Host (" {0}/{1} runs failed" -f $failureCount, $Runs)
Write-Host "============================================================"
