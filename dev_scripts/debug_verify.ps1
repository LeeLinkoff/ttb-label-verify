# debug_verify.ps1
#
# Discovers every labelN_image.(png|jpg|jpeg) in tests\ that has a
# matching labelN_text.txt, runs /api/verify against each ONCE, and
# prints the full field-by-field result for each, not just
# overallMatch. Does not hardcode any specific label name, add a new
# pair to tests\ and this picks it up automatically.
#
# Replaces the earlier label1-only version and the separate
# debug_verify_label2.ps1, one script now covers every pair in
# tests\ instead of one script per label.

Add-Type -AssemblyName System.Net.Http

$uri = "http://localhost:3002/api/verify"
$healthUri = "http://localhost:3002/api/health"
$testsDir = Join-Path $PSScriptRoot "..\tests"

# Pre-flight: confirm the backend is actually reachable before
# attempting anything else. Fails fast with one clear message instead
# of grinding through every pair and hitting the same connection
# error repeatedly.
Write-Host "Checking backend at $healthUri ..."
try {
    $healthClient = New-Object System.Net.Http.HttpClient
    $healthClient.Timeout = [TimeSpan]::FromSeconds(5)
    $healthResponse = $healthClient.GetAsync($healthUri).GetAwaiter().GetResult()
    $healthClient.Dispose()
    if (-not $healthResponse.IsSuccessStatusCode) {
        Write-Host ("ERROR: Backend responded but /api/health returned HTTP {0}." -f [int]$healthResponse.StatusCode) -ForegroundColor Red
        exit 1
    }
    Write-Host "Backend is up." -ForegroundColor Green
    Write-Host ""
}
catch {
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host " ERROR: Backend not reachable at $healthUri" -ForegroundColor Red
    Write-Host " $($_.Exception.InnerException.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host " Is the backend actually running? Start it with:" -ForegroundColor Red
    Write-Host "   run_back.bat" -ForegroundColor Red
    Write-Host " (from dev_scripts\, in a separate window, leave it running)" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
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
            TextPath  = $textPath
        }
    } else {
        Write-Host ("SKIPPING {0}: no matching {1}_text.txt found" -f $img.Name, $base) -ForegroundColor Yellow
    }
}

if ($pairs.Count -eq 0) {
    Write-Host "No label image/text pairs found in $testsDir." -ForegroundColor Red
    exit 1
}

Write-Host ("Found {0} label pair(s): {1}" -f $pairs.Count, (($pairs | ForEach-Object { $_.Label }) -join ", "))
Write-Host ""

foreach ($pair in $pairs) {
    $fields = Read-ApplicationDataFields -Path $pair.TextPath

    $client = New-Object System.Net.Http.HttpClient
    $content = New-Object System.Net.Http.MultipartFormDataContent

    $imageBytes = [System.IO.File]::ReadAllBytes($pair.ImagePath)
    $ext = [System.IO.Path]::GetExtension($pair.ImagePath).TrimStart(".").ToLower()
    $mime = if ($ext -eq "jpg" -or $ext -eq "jpeg") { "image/jpeg" } else { "image/png" }
    $imageContent = New-Object System.Net.Http.ByteArrayContent(, $imageBytes)
    $imageContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($mime)
    $content.Add($imageContent, "labelImage", [System.IO.Path]::GetFileName($pair.ImagePath))

    foreach ($key in $fields.Keys) {
        $content.Add((New-Object System.Net.Http.StringContent($fields[$key])), $key)
    }

    Write-Host "============================================================"
    Write-Host (" {0}" -f $pair.Label)
    Write-Host "============================================================"

    $response = $null
    $body = $null
    try {
        $response = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
    catch {
        Write-Host "  CONNECTION FAILED: could not reach $uri" -ForegroundColor Red
        Write-Host ("  {0}" -f $_.Exception.InnerException.Message) -ForegroundColor Red
        Write-Host "  Is the backend actually running? (run_back.bat)" -ForegroundColor Red
        Write-Host ""
        $client.Dispose()
        continue
    }
    $client.Dispose()

    if (-not $response.IsSuccessStatusCode) {
        Write-Host ("  REQUEST FAILED: HTTP {0}" -f [int]$response.StatusCode) -ForegroundColor Red
        Write-Host "  $body" -ForegroundColor Red
        Write-Host ""
        continue
    }

    try {
        $parsed = $body | ConvertFrom-Json
    } catch {
        Write-Host "  Could not parse response as JSON:" -ForegroundColor Red
        Write-Host "  $body" -ForegroundColor Red
        Write-Host ""
        continue
    }

    Write-Host "  overallMatch: $($parsed.overallMatch)"
    Write-Host ""
    foreach ($fieldName in $parsed.fields.PSObject.Properties.Name) {
        $f = $parsed.fields.$fieldName
        $color = if ($f.match) { "Green" } else { "Yellow" }
        Write-Host "  === $fieldName ===" -ForegroundColor $color
        Write-Host "    match:       $($f.match)"
        Write-Host "    needsReview: $($f.needsReview)"
        Write-Host "    extracted:   $($f.extracted)"
        Write-Host "    applied:     $($f.applied)"
        Write-Host ""
    }
}
