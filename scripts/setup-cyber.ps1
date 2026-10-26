# setup-cyber.ps1 — Installation des outils CLI pour le persona Cyber (Phase 108)
# Usage : .\scripts\setup-cyber.ps1
# Nécessite winget (Windows 10/11) et pip (Python 3.x installé).
# Tous les outils doivent être utilisés uniquement sur des systèmes autorisés.

param(
  [switch]$DryRun  # Affiche les commandes sans les exécuter
)

$tools = @(
  @{ Name = "Nmap";     Cmd = "winget"; Args = "install -e --id Insecure.Nmap -y";           Check = "nmap" },
  @{ Name = "Nuclei";   Cmd = "winget"; Args = "install -e --id ProjectDiscovery.Nuclei -y"; Check = "nuclei" },
  @{ Name = "Gobuster"; Cmd = "winget"; Args = "install -e --id OJ.Gobuster -y";              Check = "gobuster" },
  @{ Name = "ffuf";     Cmd = "winget"; Args = "install -e --id ffuf.ffuf -y";               Check = "ffuf" },
  @{ Name = "Semgrep";  Cmd = "pip";    Args = "install semgrep --quiet";                    Check = "semgrep" },
  @{ Name = "sqlmap";   Cmd = "pip";    Args = "install sqlmap --quiet";                     Check = "sqlmap" },
  @{ Name = "Wireshark (tshark)"; Cmd = "winget"; Args = "install -e --id WiresharkFoundation.Wireshark -y"; Check = "tshark" }
)

Write-Host "`n=== Setup Cyber — Outils de sécurité éthique ===" -ForegroundColor Cyan
Write-Host "RAPPEL : ces outils ne doivent être utilisés que sur des systèmes autorisés.`n" -ForegroundColor Yellow

foreach ($tool in $tools) {
  $already = Get-Command $tool.Check -ErrorAction SilentlyContinue
  if ($already) {
    Write-Host "[$($tool.Name)] Déjà installé : $($already.Source)" -ForegroundColor Green
    continue
  }

  Write-Host "[$($tool.Name)] Installation..." -ForegroundColor Cyan
  if ($DryRun) {
    Write-Host "  DRY-RUN : $($tool.Cmd) $($tool.Args)" -ForegroundColor DarkGray
  } else {
    try {
      & $tool.Cmd $tool.Args.Split(" ")
      Write-Host "  ✓ Installé" -ForegroundColor Green
    } catch {
      Write-Host "  ✗ Échec : $_" -ForegroundColor Red
    }
  }
}

Write-Host "`n=== Vérification finale ===" -ForegroundColor Cyan
foreach ($tool in $tools) {
  $ok = Get-Command $tool.Check -ErrorAction SilentlyContinue
  $status = if ($ok) { "✓ OK" } else { "✗ ABSENT" }
  $color  = if ($ok) { "Green" } else { "Red" }
  Write-Host "  $status  $($tool.Name) ($($tool.Check))" -ForegroundColor $color
}

Write-Host "`nPour utiliser le persona Cyber dans ShamCode :" -ForegroundColor Cyan
Write-Host "  1. Activez 'Autoriser les commandes shell' dans Paramètres > Agent" -ForegroundColor White
Write-Host "  2. Cliquez sur le bouton 🛡 dans la barre de composition" -ForegroundColor White
