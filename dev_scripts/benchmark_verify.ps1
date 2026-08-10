# benchmark_verify.ps1
#
# Discovers every labelN_image.(png|jpg|jpeg) in tests\ that has a
# matching labelN_text.txt, and runs /api/verify against each one
# $RunsPerImage times (default 10), reporting per-image and overall
# average/min/max latency plus overallMatch per run.
#
# Does NOT hardcode label1, or any specific label name. Add a new
# label3_image.png + label3_text.txt to tests\ and this picks it up
# automatically next run, nothing in this script needs to change.
#
# Application-data fields for each image are parsed directly from its
# matching _text.txt at run time, not duplicated in this script, same
# reasoning as before: two copies of the same fact drift apart, one
# copy can't.
#
# Builds the multipart/form-data request manually via .NET's
# HttpClient rather than Invoke-RestMethod -Form, which only exists
# in PowerShell 6.1+ (pwsh) and fails on Windows PowerShell 5.1 (the
# default powershell.exe on Windows). This version works on both.
#
# Lives in dev_scripts\, resolves tests\ relative to its own location
# ($PSScriptRoot), works correctly from any current directory.
#
# Backend must already be running (run_back.bat), hits localhost:3002
# by default, change $uri to test the deployed URL instead.

Add-Type -AssemblyName System.Net.Http

$uri = "http://localhost:3002/api/verify"
$healthUri = "http://localhost:3002/api/health"
$testsDir = Join-Path $PSScriptRoot "..\tests"
$RunsPerImage = 10

# Pre-flight: confirm the backend is actually reachable before
# attempting anything else. Fails fast with one clear message instead
# of grinding through every pair/run and hitting the same connection
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

function Invoke-VerifyOnce {
    param(
        [string]$Uri,
        [string]$ImagePath,
        [hashtable]$Fields
    )

    $client = New-Object System.Net.Http.HttpClient
    try {
        $content = New-Object System.Net.Http.MultipartFormDataContent

        $imageBytes = [System.IO.File]::ReadAllBytes($ImagePath)
        $ext = [System.IO.Path]::GetExtension($ImagePath).TrimStart(".").ToLower()
        $mime = if ($ext -eq "jpg" -or $ext -eq "jpeg") { "image/jpeg" } else { "image/png" }
        $imageContent = New-Object System.Net.Http.ByteArrayContent(, $imageBytes)
        $imageContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($mime)
        $content.Add($imageContent, "labelImage", [System.IO.Path]::GetFileName($ImagePath))

        foreach ($key in $Fields.Keys) {
            $fieldContent = New-Object System.Net.Http.StringContent($Fields[$key])
            $content.Add($fieldContent, $key)
        }

        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $response = $client.PostAsync($Uri, $content).GetAwaiter().GetResult()
            $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        }
        catch {
            $sw.Stop()
            return @{
                Success = $false
                Elapsed = $sw.Elapsed.TotalSeconds
                Body    = "Connection failed: $($_.Exception.InnerException.Message) - is the backend running? (run_back.bat)"
                Status  = 0
            }
        }
        $sw.Stop()

        return @{
            Success = $response.IsSuccessStatusCode
            Elapsed = $sw.Elapsed.TotalSeconds
            Body    = $body
            Status  = [int]$response.StatusCode
        }
    }
    finally {
        $client.Dispose()
    }
}

# Discover pairs: any *_image.(png|jpg|jpeg) with a matching
# *_text.txt sitting next to it. Anything without a matching text
# file is skipped with a warning rather than silently ignored.
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

Write-Host "============================================================"
Write-Host (" Found {0} label pair(s) in {1}:" -f $pairs.Count, $testsDir)
foreach ($p in $pairs) { Write-Host ("   - {0}" -f $p.Label) }
Write-Host (" Benchmarking {0}, {1} run(s) per image" -f $uri, $RunsPerImage)
Write-Host "============================================================"

$allLatencies = @()
$grandFailures = 0

foreach ($pair in $pairs) {
    $fields = Read-ApplicationDataFields -Path $pair.TextPath
    Write-Host ""
    Write-Host ("--- {0} ---" -f $pair.Label)
    Write-Host ("  Image: {0}" -f $pair.ImagePath)
    Write-Host "  Fields:"
    foreach ($key in $fields.Keys) {
        Write-Host ("    {0,-16} {1}" -f $key, $fields[$key])
    }
    Write-Host ""

    $latencies = @()
    $failures = 0

    for ($i = 1; $i -le $RunsPerImage; $i++) {
        $result = Invoke-VerifyOnce -Uri $uri -ImagePath $pair.ImagePath -Fields $fields

        if ($result.Success) {
            $latencies += $result.Elapsed
            $allLatencies += $result.Elapsed
            try {
                $parsed = $result.Body | ConvertFrom-Json
                $overallMatch = $parsed.overallMatch
            } catch {
                $overallMatch = "(could not parse response)"
            }
            Write-Host ("  Run {0,2}: {1,5:N2}s   overallMatch={2}" -f $i, $result.Elapsed, $overallMatch)
        } else {
            $failures++
            $grandFailures++
            Write-Host ("  Run {0,2}: FAILED after {1:N2}s   HTTP {2}   {3}" -f $i, $result.Elapsed, $result.Status, $result.Body) -ForegroundColor Red
        }
    }

    if ($latencies.Count -gt 0) {
        $avg = ($latencies | Measure-Object -Average).Average
        $min = ($latencies | Measure-Object -Minimum).Minimum
        $max = ($latencies | Measure-Object -Maximum).Maximum
        Write-Host ("  {0} summary: {1}/{2} ok, avg {3:N2}s, min {4:N2}s, max {5:N2}s" -f $pair.Label, $latencies.Count, $RunsPerImage, $avg, $min, $max)
    } else {
        Write-Host ("  {0}: all runs failed" -f $pair.Label) -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "============================================================"
Write-Host " OVERALL (all label pairs combined)"
if ($allLatencies.Count -gt 0) {
    $avg = ($allLatencies | Measure-Object -Average).Average
    $min = ($allLatencies | Measure-Object -Minimum).Minimum
    $max = ($allLatencies | Measure-Object -Maximum).Maximum
    Write-Host (" Successful runs: {0}/{1}" -f $allLatencies.Count, ($pairs.Count * $RunsPerImage))
    Write-Host (" Average: {0:N2}s" -f $avg)
    Write-Host (" Min:     {0:N2}s" -f $min)
    Write-Host (" Max:     {0:N2}s" -f $max)
} else {
    Write-Host " All runs failed, no latency data collected." -ForegroundColor Red
}
if ($grandFailures -gt 0) {
    Write-Host (" Total failures: {0}" -f $grandFailures) -ForegroundColor Yellow
}
Write-Host "============================================================"
