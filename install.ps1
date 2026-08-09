<#
.SYNOPSIS
  spec-md installer for Windows — drop the spec-md skill and/or agent rule files into a project.

.EXAMPLE
  irm https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.ps1 | iex

.EXAMPLE
  ./install.ps1 -All
  ./install.ps1 -Claude -Cursor

  With no agent switches it installs the Claude Code skill globally
  (~/.claude/skills/spec-md) and writes AGENTS.md + .agents/skills/spec-md
  into the current project.
#>
[CmdletBinding()]
param(
  [switch]$Claude,
  [switch]$Cursor,
  [switch]$Windsurf,
  [switch]$Cline,
  [switch]$Copilot,
  [switch]$Agents,
  [switch]$All,
  [switch]$Local,
  [string]$Dir = (Get-Location).Path
)

$ErrorActionPreference = "Stop"
$Repo   = "rosenjcb/spec.md"
$Branch = if ($env:SPEC_MD_REF) { $env:SPEC_MD_REF } else { "main" }
$Base   = "https://raw.githubusercontent.com/$Repo/$Branch"
$SkillName = "spec-md"

# Local checkout detection.
$SrcDir = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "SKILL.md"))) { $SrcDir = $PSScriptRoot }

function Say  ($m) { Write-Host "› $m" -ForegroundColor Blue }
function Ok   ($m) { Write-Host "✓ $m" -ForegroundColor Green }

function Fetch ($rel, $dest) {
  $destDir = Split-Path -Parent $dest
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
  if ($SrcDir -and (Test-Path (Join-Path $SrcDir $rel))) {
    Copy-Item (Join-Path $SrcDir $rel) $dest -Force
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$rel" -OutFile $dest
  }
}

function Install-AgentsSkill ($destDir) {
  $portable = ".agents/skills/$SkillName/SKILL.md"
  $dest = Join-Path $destDir "SKILL.md"
  if ($SrcDir -and (Test-Path (Join-Path $SrcDir $portable))) {
    Fetch $portable $dest
  } else {
    Fetch "SKILL.md" $dest
  }
}

if ($All) { $Claude=$true; $Cursor=$true; $Windsurf=$true; $Cline=$true; $Copilot=$true; $Agents=$true }
$any = $Claude -or $Cursor -or $Windsurf -or $Cline -or $Copilot -or $Agents
if (-not $any) { $Claude = $true; $Agents = $true }

Write-Host "spec-md installer  ($Repo@$Branch)`n" -ForegroundColor White
if ($SrcDir) { Say "using local checkout" } else { Say "downloading from GitHub" }

if ($Claude) {
  $skillDir = if ($Local) { Join-Path $Dir ".claude/skills/$SkillName" } else { Join-Path $HOME ".claude/skills/$SkillName" }
  # SKILL.md is self-contained (its TESTING.md reference is an absolute URL).
  Fetch "SKILL.md" (Join-Path $skillDir "SKILL.md")
  Ok "Claude Code skill -> $skillDir  (invoke as /$SkillName)"
}
if ($Cursor) {
  Fetch ".cursor/rules/spec-md.mdc" (Join-Path $Dir ".cursor/rules/spec-md.mdc")
  Ok "Cursor rule installed"
  Install-AgentsSkill (Join-Path $Dir ".agents/skills/$SkillName")
  Ok "Agent skill -> .agents/skills/$SkillName  (invoke as /$SkillName)"
}
if ($Windsurf) { Fetch ".windsurf/rules/spec-md.md"       (Join-Path $Dir ".windsurf/rules/spec-md.md");       Ok "Windsurf rule installed" }
if ($Cline)    { Fetch ".clinerules/spec-md.md"           (Join-Path $Dir ".clinerules/spec-md.md");           Ok "Cline rule installed" }
if ($Copilot)  { Fetch ".github/copilot-instructions.md"  (Join-Path $Dir ".github/copilot-instructions.md");  Ok "Copilot instructions installed" }
if ($Agents) {
  Fetch "AGENTS.md" (Join-Path $Dir "AGENTS.md")
  Ok "AGENTS.md installed"
  Install-AgentsSkill (Join-Path $Dir ".agents/skills/$SkillName")
  Ok "Agent skill -> .agents/skills/$SkillName  (Cursor/Codex /$SkillName)"
}

Write-Host "`nDone." -ForegroundColor Green
Say "Next: npm i -D @rosenjcb/spec-md   then   npx @rosenjcb/spec-md check"
