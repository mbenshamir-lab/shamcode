'use strict';
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

/**
 * Génère un fichier audio WAV depuis un texte via Windows SAPI (Text-To-Speech intégré).
 * Fonctionne hors-ligne, gratuit, aucune dépendance npm.
 * Voix disponibles selon la langue du système Windows (ex : Zira, David, Aria).
 */
async function generateSpeech(args, guard, projectRoot) {
  const text = String(args.text || '').trim();
  if (!text) return { ok: false, error: 'TEXTE_MANQUANT — args.text est obligatoire' };

  const outName = String(args.output || `speech_${Date.now()}.wav`);
  let outPath;
  try {
    outPath = guard ? guard(outName) : path.resolve(projectRoot || '.', outName);
  } catch (err) {
    return { ok: false, error: `CHEMIN_INVALIDE : ${err.message}` };
  }

  const rate   = Math.min(10, Math.max(-10, Number(args.rate)   || 0));   // -10 lent … +10 rapide
  const volume = Math.min(100, Math.max(0,  Number(args.volume) || 100));
  const voice  = String(args.voice || '');

  // Écriture du script PowerShell dans un fichier temp pour éviter les problèmes d'échappement
  const scriptPath = path.join(os.tmpdir(), `sc_tts_${Date.now()}.ps1`);

  // Utiliser le chemin Windows natif pour SetOutputToWaveFile
  const outPathWin = outPath.replace(/\//g, '\\');

  const voiceBlock = voice
    ? `try { $tts.SelectVoice('${voice.replace(/'/g, "''")}') } catch { <# voix non trouvée, voix par défaut #> }`
    : '';

  const psScript = `
Add-Type -AssemblyName System.Speech
$tts = New-Object System.Speech.Synthesis.SpeechSynthesizer
${voiceBlock}
$tts.Rate = ${rate}
$tts.Volume = ${volume}
$tts.SetOutputToWaveFile('${outPathWin.replace(/'/g, "''")}')
$tts.Speak(@'
${text.replace(/'@/g, "' @")}
'@)
$tts.Dispose()
`;

  fs.writeFileSync(scriptPath, psScript, 'utf8');

  try {
    await _runPowerShell(scriptPath);
  } catch (err) {
    try { fs.unlinkSync(scriptPath); } catch { /* ignoré */ }
    return { ok: false, error: err.message };
  }

  try { fs.unlinkSync(scriptPath); } catch { /* ignoré */ }

  if (!fs.existsSync(outPath)) {
    return { ok: false, error: 'SAPI_ÉCHEC — le fichier WAV n\'a pas été créé (vérifiez les voix installées dans Paramètres Windows > Heure et langue > Synthèse vocale)' };
  }

  const sizeKo = Math.round(fs.statSync(outPath).size / 1024);
  return { ok: true, content: `Audio généré → ${outName} (${sizeKo} Ko${voice ? ', voix : ' + voice : ''})` };
}

/**
 * Liste les voix SAPI disponibles sur ce Windows.
 * Retourne un tableau de noms utilisables dans args.voice.
 */
async function listSpeechVoices() {
  const scriptPath = path.join(os.tmpdir(), `sc_voices_${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath, `
Add-Type -AssemblyName System.Speech
$tts = New-Object System.Speech.Synthesis.SpeechSynthesizer
$tts.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
`, 'utf8');

  try {
    const output = await _runPowerShellCapture(scriptPath);
    try { fs.unlinkSync(scriptPath); } catch { /* ignoré */ }
    const voices = output.split('\n').map(l => l.trim()).filter(Boolean);
    return { ok: true, content: `Voix disponibles (${voices.length}) : ${voices.join(', ')}` };
  } catch (err) {
    try { fs.unlinkSync(scriptPath); } catch { /* ignoré */ }
    return { ok: false, error: err.message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _runPowerShell(scriptPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => reject(new Error(`POWERSHELL_ERREUR : ${err.message}`)));
    proc.on('close', code => {
      if (code === 0) return resolve();
      const errLine = stderr.split('\n').find(l => l.includes('Exception') || l.includes('Error')) || stderr.trim();
      reject(new Error(`SAPI_ERREUR (code ${code}) : ${errLine || 'erreur inconnue'}`));
    });
  });
}

function _runPowerShellCapture(scriptPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => reject(new Error(`POWERSHELL_ERREUR : ${err.message}`)));
    proc.on('close', code => {
      if (code === 0) return resolve(stdout);
      reject(new Error(`code ${code} : ${stderr.trim()}`));
    });
  });
}

module.exports = { generateSpeech, listSpeechVoices };
