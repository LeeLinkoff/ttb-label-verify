# test_batch_verify.ps1
#
# Real test of POST /api/verify/batch, the one endpoint that had
# never actually been hit despite label1/label2 both being confirmed
# individually via /api/verify. Discovers every labelN_image.*/
# labelN_text.txt pair in tests\ (same discovery logic as
# benchmark_verify.ps1/debug_verify.ps1) and submits them all
# together in ONE batch request, not one at a time, so this actually
# exercises services/batch.ts and the labelImages[]/applications[]
# array-position matching, not just repeated single-verify calls.
#
# Expected result with the current tests\ pair: results[0] (label1)
# ok:true, overallMatch:true. results[1] (label2) ok:true,
# overallMatch:false, isolated to warningStatement.

Add-Type -AssemblyName System.Net.Http

$uri = "http://localhost:3002/api/verify/batch"
$healthUri = "http://localhost:3002/api/health"
$testsDir = Join-Path $PSScriptRoot "..\tests"

Write-Host "Checking backend at $healthUri ..."
try {
    $healthClient = New-Object System.Net.Http.HttpClient
    $healthClient.Timeout = [TimeSpan]::FromSeconds(5)
    $healthResponse = $healthClient.GetAsync($healthUri).GetAwaiter().GetResult()
    $healthClient.Dispose()
    if (-not $healthResponse.IsSuccessStatusCode) {
        Write-Host ("ERROR: /api/health returned HTTP {0}." -f [int]$healthResponse.StatusCode) -ForegroundColor Red
        exit 1
    }
    Write-Host "Backend is up." -ForegroundColor Green
    Write-Host ""
}
catch {
    Write-Host "ERROR: Backend not reachable at $healthUri" -ForegroundColor Red
    Write-Host "Is it running? Start it with run_back.bat" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $testsDir)) {
    Write-Host "ERROR: $testsDir not found." -ForegroundColor Red
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

$imageFiles = Get-ChildItem -Path $testsDir -File |
    Where-Object { $_.Name -match '^(.+)_image\.(png|jpg|jpeg)$' } |
    Sort-Object Name

$pairs = @()
foreach ($img in $imageFiles) {
    $base = $img.Name -replace '_image\.(png|jpg|jpeg)$', ''
    $textPath = Join-Path $testsDir "${base}_text.txt"
    if (Test-Path $textPath) {
        $pairs += [pscustomobject]@{
            Label     = $base
            ImagePath = $img.FullName
            Fields    = Read-ApplicationDataFields -Path $textPath
        }
    } else {
        Write-Host ("SKIPPING {0}: no matching {1}_text.txt found" -f $img.Name, $base) -ForegroundColor Yellow
    }
}

if ($pairs.Count -eq 0) {
    Write-Host "No label image/text pairs found in $testsDir." -ForegroundColor Red
    exit 1
}

Write-Host ("Submitting {0} label(s) in ONE batch request: {1}" -f $pairs.Count, (($pairs | ForEach-Object { $_.Label }) -join ", "))
Write-Host ""

# Build the multipart body: every image under the SAME field name
# "labelImages" (this is what upload.array("labelImages") on the
# backend expects), plus one "applications" field holding the JSON
# array, in the same order the images were added, since the backend
# matches them strictly by array position.
$client = New-Object System.Net.Http.HttpClient
$content = New-Object System.Net.Http.MultipartFormDataContent

foreach ($pair in $pairs) {
    $imageBytes = [System.IO.File]::ReadAllBytes($pair.ImagePath)
    $ext = [System.IO.Path]::GetExtension($pair.ImagePath).TrimStart(".").ToLower()
    $mime = if ($ext -eq "jpg" -or $ext -eq "jpeg") { "image/jpeg" } else { "image/png" }
    $imageContent = New-Object System.Net.Http.ByteArrayContent(, $imageBytes)
    $imageContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($mime)
    $content.Add($imageContent, "labelImages", [System.IO.Path]::GetFileName($pair.ImagePath))
}

$applicationsArray = $pairs | ForEach-Object { $_.Fields }
# ConvertTo-Json's -AsArray parameter doesn't exist in Windows
# PowerShell 5.1, it's PS 6.2+ only. Building the array brackets
# manually instead, works identically on 5.1 and 7+, and doesn't
# depend on PowerShell's array-unrolling quirks around -InputObject.
$applicationsJsonParts = $applicationsArray | ForEach-Object {
    $_ | ConvertTo-Json -Depth 5 -Compress
}
$applicationsJson = "[" + ($applicationsJsonParts -join ",") + "]"
$content.Add((New-Object System.Net.Http.StringContent($applicationsJson)), "applications")

Write-Host "applications JSON sent:"
Write-Host $applicationsJson
Write-Host ""

try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $response = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $sw.Stop()
}
catch {
    Write-Host "CONNECTION FAILED: $($_.Exception.InnerException.Message)" -ForegroundColor Red
    $client.Dispose()
    exit 1
}
$client.Dispose()

Write-Host ("HTTP {0}, {1:N2}s" -f [int]$response.StatusCode, $sw.Elapsed.TotalSeconds)
Write-Host ""

if (-not $response.IsSuccessStatusCode) {
    Write-Host "REQUEST FAILED:" -ForegroundColor Red
    Write-Host $body -ForegroundColor Red
    exit 1
}

try {
    $parsed = $body | ConvertFrom-Json
}
catch {
    Write-Host "Could not parse response as JSON:" -ForegroundColor Red
    Write-Host $body -ForegroundColor Red
    exit 1
}

foreach ($item in $parsed.results) {
    $label = $pairs[$item.index].Label
    Write-Host "============================================================"
    Write-Host (" results[{0}]  ({1})" -f $item.index, $label)
    Write-Host "============================================================"
    Write-Host ("  ok: {0}" -f $item.ok)

    if ($item.ok) {
        Write-Host ("  overallMatch: {0}" -f $item.result.overallMatch)
        foreach ($fieldName in $item.result.fields.PSObject.Properties.Name) {
            $f = $item.result.fields.$fieldName
            $color = if ($f.match) { "Green" } else { "Yellow" }
            Write-Host ("    {0,-16} match={1,-5} needsReview={2}" -f $fieldName, $f.match, $f.needsReview) -ForegroundColor $color
        }
    } else {
        Write-Host ("  error: {0}" -f $item.error) -ForegroundColor Red
    }
    Write-Host ""
}
