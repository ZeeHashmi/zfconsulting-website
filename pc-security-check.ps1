# ZF Consulting Services - Windows PC Security Health Check
# Read-only checks. No files are uploaded and no network connections are made.
# Run as a standard user. This script does not prove whether a PC is compromised.

$ErrorActionPreference = "SilentlyContinue"
$timestamp = Get-Date
$computer = $env:COMPUTERNAME
$os = Get-CimInstance Win32_OperatingSystem

$checks = @()

function Add-Check {
    param([string]$Name,[string]$Status,[string]$Details)
    $script:checks += [pscustomobject]@{
        Check = $Name
        Status = $Status
        Details = $Details
    }
}

# Windows Defender status, where available
try {
    $defender = Get-MpComputerStatus
    if ($null -ne $defender) {
        $avStatus = if ($defender.AntivirusEnabled) { "Enabled" } else { "Not enabled" }
        $rtStatus = if ($defender.RealTimeProtectionEnabled) { "Enabled" } else { "Not enabled" }
        Add-Check "Microsoft Defender antivirus" $avStatus "AntivirusEnabled: $($defender.AntivirusEnabled)"
        Add-Check "Real-time protection" $rtStatus "RealTimeProtectionEnabled: $($defender.RealTimeProtectionEnabled)"
        Add-Check "Security intelligence age" "Informational" "Last update: $($defender.AntivirusSignatureLastUpdated)"
    } else {
        Add-Check "Microsoft Defender" "Not available" "Defender status could not be queried. Another security product may be installed."
    }
} catch {
    Add-Check "Microsoft Defender" "Unknown" "Defender status was unavailable to this account or system."
}

# Windows Firewall profiles
try {
    $profiles = Get-NetFirewallProfile
    foreach ($profile in $profiles) {
        $status = if ($profile.Enabled) { "Enabled" } else { "Disabled" }
        Add-Check "Firewall - $($profile.Name)" $status "Default inbound action: $($profile.DefaultInboundAction); outbound: $($profile.DefaultOutboundAction)"
    }
} catch {
    Add-Check "Windows Firewall" "Unknown" "Firewall profile status could not be queried."
}

# OS details and latest installed hotfix visible through Get-HotFix
Add-Check "Windows version" "Informational" "$($os.Caption), version $($os.Version), build $($os.BuildNumber)"
$hotfix = Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1
if ($hotfix) {
    Add-Check "Most recent listed hotfix" "Informational" "$($hotfix.HotFixID), installed $($hotfix.InstalledOn)"
} else {
    Add-Check "Most recent listed hotfix" "Unknown" "No hotfix information was returned. This is not proof that updates are missing."
}

# Create a local HTML report. Values are HTML-encoded before insertion.
$rows = foreach ($check in $checks) {
    $name = [System.Net.WebUtility]::HtmlEncode([string]$check.Check)
    $status = [System.Net.WebUtility]::HtmlEncode([string]$check.Status)
    $details = [System.Net.WebUtility]::HtmlEncode([string]$check.Details)
    "<tr><td>$name</td><td>$status</td><td>$details</td></tr>"
}

$reportPath = Join-Path ([Environment]::GetFolderPath("Desktop")) ("ZF-PC-Security-Health-Check-" + $timestamp.ToString("yyyyMMdd-HHmmss") + ".html")
$reportHtml = @"
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZF PC Security Health Check</title>
<style>
body{font-family:Arial,sans-serif;background:#0b1118;color:#edf4fb;margin:0;padding:28px}
main{max-width:1000px;margin:auto}h1{color:#8dcaff}p{color:#c5d2df}
table{width:100%;border-collapse:collapse;background:#121e2a}
th,td{text-align:left;padding:12px;border:1px solid #304253;vertical-align:top}
th{background:#1b3043} .note{background:#2a2415;border-left:4px solid #e5b64c;padding:14px}
</style></head><body><main>
<h1>ZF Consulting Services - PC Security Health Check</h1>
<p>Computer: $([System.Net.WebUtility]::HtmlEncode($computer)) | Generated: $($timestamp.ToString("yyyy-MM-dd HH:mm:ss"))</p>
<div class="note"><strong>Important:</strong> This is a limited configuration health check, not a malware scan or forensic investigation. It cannot determine whether this computer has been hacked.</div>
<h2>Results</h2><table><thead><tr><th>Check</th><th>Status</th><th>Details</th></tr></thead><tbody>
$($rows -join "`n")
</tbody></table>
<p>No information was uploaded or sent by this script. This report is saved locally on your Desktop.</p>
<p>ZF Consulting Services | 0406 889 204 | info@zfconsulting.com.au</p>
</main></body></html>
"@

Set-Content -Path $reportPath -Value $reportHtml -Encoding UTF8
Write-Host ""
Write-Host "ZF PC Security Health Check completed." -ForegroundColor Green
Write-Host "Your local report: $reportPath" -ForegroundColor Cyan
Write-Host "No data was uploaded or emailed." -ForegroundColor Yellow
Start-Process $reportPath
