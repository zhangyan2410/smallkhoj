#!/usr/bin/env pwsh
# Claude Code Provider Switcher
# Usage:
#   .\cc-switch.ps1 deepseek-v4-pro -Key "sk-xxx"
#   .\cc-switch.ps1 deepseek-v4-flash -Key "sk-xxx"
#   .\cc-switch.ps1 minimax -Key "sk-xxx"
#   .\cc-switch.ps1 anthropic -Key "sk-ant-xxx"
#   .\cc-switch.ps1 list

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("anthropic", "deepseek-v4-pro", "deepseek-v4-flash", "minimax", "42w-deepseek-v4-pro", "list")]
    [string]$Profile,

    [Parameter(Mandatory = $false)]
    [string]$Key
)

$SettingsPath = "$env:USERPROFILE\.claude\settings.json"
$SettingsPathLocal = "$env:USERPROFILE\.claude\settings.local.json"

$Profiles = @{
    "anthropic" = @{
        Name = "Anthropic Official"
        Env  = @{
            ANTHROPIC_API_KEY                = ""
            ANTHROPIC_BASE_URL               = "https://api.anthropic.com"
            ANTHROPIC_MODEL                  = "claude-sonnet-4-6"
            ANTHROPIC_REASONING_MODEL        = "claude-opus-4-6"
            ANTHROPIC_DEFAULT_HAIKU_MODEL    = "claude-haiku-4"
            ANTHROPIC_DEFAULT_SONNET_MODEL   = "claude-sonnet-4-6"
            ANTHROPIC_DEFAULT_OPUS_MODEL     = "claude-opus-4-6"
            API_TIMEOUT_MS                   = "300000"
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 1
        }
    }
    "deepseek-v4-pro" = @{
        Name = "DeepSeek V4 Pro"
        Env  = @{
            ANTHROPIC_API_KEY                = ""
            ANTHROPIC_BASE_URL               = "https://api.deepseek.com/anthropic"
            ANTHROPIC_MODEL                  = "deepseek-v4-pro"
            ANTHROPIC_REASONING_MODEL        = "deepseek-v4-pro"
            ANTHROPIC_DEFAULT_HAIKU_MODEL    = "deepseek-v4-flash"
            ANTHROPIC_DEFAULT_SONNET_MODEL   = "deepseek-v4-pro"
            ANTHROPIC_DEFAULT_OPUS_MODEL     = "deepseek-v4-pro"
            API_TIMEOUT_MS                   = "300000"
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 1
        }
    }
    "deepseek-v4-flash" = @{
        Name = "DeepSeek V4 Flash"
        Env  = @{
            ANTHROPIC_API_KEY                = ""
            ANTHROPIC_BASE_URL               = "https://api.deepseek.com/anthropic"
            ANTHROPIC_MODEL                  = "deepseek-v4-flash"
            ANTHROPIC_REASONING_MODEL        = "deepseek-v4-pro"
            ANTHROPIC_DEFAULT_HAIKU_MODEL    = "deepseek-v4-flash"
            ANTHROPIC_DEFAULT_SONNET_MODEL   = "deepseek-v4-flash"
            ANTHROPIC_DEFAULT_OPUS_MODEL     = "deepseek-v4-pro"
            API_TIMEOUT_MS                   = "300000"
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 1
        }
    }
    "minimax" = @{
        Name = "MiniMax"
        Env  = @{
            ANTHROPIC_API_KEY                = ""
            ANTHROPIC_BASE_URL               = "https://api.minimaxi.com/anthropic"
            ANTHROPIC_MODEL                  = "MiniMax-M2.7"
            ANTHROPIC_REASONING_MODEL        = "MiniMax-M2.7"
            ANTHROPIC_DEFAULT_HAIKU_MODEL    = "MiniMax-M2.7"
            ANTHROPIC_DEFAULT_SONNET_MODEL   = "MiniMax-M2.7"
            ANTHROPIC_DEFAULT_OPUS_MODEL     = "MiniMax-M2.7"
            API_TIMEOUT_MS                   = "300000"
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 1
        }
    }
    "42w-deepseek-v4-pro" = @{
        Name = "42w DeepSeek V4 Pro"
        Env  = @{
            ANTHROPIC_API_KEY                = ""
            ANTHROPIC_BASE_URL               = "https://api.42w.shop/v1/anthropic"
            ANTHROPIC_MODEL                  = "deepseek-v4-pro"
            ANTHROPIC_REASONING_MODEL        = "deepseek-v4-pro"
            ANTHROPIC_DEFAULT_HAIKU_MODEL    = "deepseek-v4-pro"
            ANTHROPIC_DEFAULT_SONNET_MODEL   = "deepseek-v4-pro"
            ANTHROPIC_DEFAULT_OPUS_MODEL     = "deepseek-v4-pro"
            API_TIMEOUT_MS                   = "300000"
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 1
        }
    }
}

# List profiles
if ($Profile -eq "list") {
    Write-Host "Available profiles:" -ForegroundColor Cyan
    foreach ($key in $Profiles.Keys | Sort-Object) {
        $marker = if ($key -match "deepseek") { "  <-- NEW" } else { "" }
        Write-Host "  $key`t- $($Profiles[$key].Name)$marker"
    }
    Write-Host ""
    Write-Host "Usage: cc-switch <profile> [-Key <api_key>]" -ForegroundColor Yellow
    return
}

# Validate settings file exists
if (-not (Test-Path $SettingsPath)) {
    Write-Error "Claude Code settings not found at $SettingsPath"
    exit 1
}

# Read current settings
$Settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json -Depth 10 -AsHashtable
if (-not $Settings) { $Settings = @{} }

# Backup
$BackupPath = "$SettingsPath.backup.$(Get-Date -Format 'yyyyMMddHHmmss')"
Copy-Item $SettingsPath $BackupPath -Force
Write-Host "Backup: $BackupPath" -ForegroundColor DarkGray

# Ensure env section exists
if (-not $Settings['env']) {
    $Settings['env'] = @{}
}

$Selected = $Profiles[$Profile]

# Apply env values
foreach ($key in $Selected.Env.Keys) {
    $value = $Selected.Env[$key]

    # Handle API key
    if ($key -eq "ANTHROPIC_API_KEY") {
        if (-not [string]::IsNullOrEmpty($Key)) {
            $value = $Key
        } elseif (-not [string]::IsNullOrEmpty($Settings['env'][$key])) {
            # Prompt to confirm reuse or enter new key if provider changed
            $currentUrl = $Settings['env']['ANTHROPIC_BASE_URL']
            $newUrl = $Selected.Env['ANTHROPIC_BASE_URL']
            if ($currentUrl -ne $newUrl) {
                Write-Host "Provider changed from $currentUrl to $newUrl" -ForegroundColor Yellow
                $newKey = Read-Host "Enter API key for $($Selected.Name) (press Enter to keep existing)"
                if (-not [string]::IsNullOrEmpty($newKey)) {
                    $value = $newKey
                } else {
                    $value = $Settings['env'][$key]
                }
            } else {
                $value = $Settings['env'][$key]
            }
        } else {
            $value = Read-Host "Enter API key for $($Selected.Name)"
        }
    }

    $Settings['env'][$key] = $value
}

# Save
$Settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsPath -Encoding UTF8

# Also update settings.local.json
if (Test-Path $SettingsPathLocal) {
    $LocalSettings = Get-Content $SettingsPathLocal -Raw | ConvertFrom-Json -Depth 10 -AsHashtable
    if ($LocalSettings -and $LocalSettings['env']) {
        foreach ($key in $Selected.Env.Keys) {
            $LocalSettings['env'][$key] = $Settings['env'][$key]
        }
        $LocalSettings | ConvertTo-Json -Depth 10 | Set-Content $SettingsPathLocal -Encoding UTF8
    }
}

Write-Host ""
Write-Host "Switched to [$($Selected.Name)]" -ForegroundColor Green
Write-Host "  Base URL : $($Selected.Env.ANTHROPIC_BASE_URL)" -ForegroundColor Gray
Write-Host "  Model    : $($Selected.Env.ANTHROPIC_MODEL)" -ForegroundColor Gray
Write-Host "  API Key  : $($Settings['env']['ANTHROPIC_API_KEY'].Substring(0, [Math]::Min(20, $Settings['env']['ANTHROPIC_API_KEY'].Length)))..." -ForegroundColor Gray
Write-Host ""
Write-Host "Restart Claude Code / VS Code for changes to take effect." -ForegroundColor Cyan
