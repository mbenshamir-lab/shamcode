'use strict';
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

/**
 * Fusionne plusieurs clips vidéo en un seul fichier via ffmpeg.
 * ffmpeg doit être installé et accessible dans le PATH système.
 * Installation Windows : winget install ffmpeg
 */
async function mergeVideos(args, guard, projectRoot) {
  const inputs = Array.isArray(args.inputs) ? args.inputs : [];
  if (inputs.length < 2) {
    return { ok: false, error: 'INPUTS_MANQUANTS — args.inputs doit contenir au moins 2 chemins de clips' };
  }

  const outName = String(args.output || `merged_${Date.now()}.mp4`);
  let outPath;
  try {
    outPath = guard ? guard(outName) : path.resolve(projectRoot || '.', outName);
  } catch (err) {
    return { ok: false, error: `CHEMIN_INVALIDE : ${err.message}` };
  }

  // Résoudre tous les chemins d'entrée dans le projectRoot
  const inputPaths = inputs.map(p => {
    try { return guard ? guard(String(p)) : path.resolve(projectRoot || '.', String(p)); }
    catch { return null; }
  });
  for (let i = 0; i < inputPaths.length; i++) {
    if (!inputPaths[i]) return { ok: false, error: `CHEMIN_INVALIDE pour l'entrée ${i + 1}` };
    if (!fs.existsSync(inputPaths[i])) return { ok: false, error: `FICHIER_MANQUANT : ${inputs[i]}` };
  }

  // Fichier liste pour le demuxer concat de ffmpeg
  const listPath = path.join(os.tmpdir(), `sc_concat_${Date.now()}.txt`);
  // Les chemins Windows avec backslash doivent être échappés dans le format concat
  const listContent = inputPaths.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listPath, listContent, 'utf8');

  const ffmpegArgs = [
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c', 'copy',   // copie sans ré-encodage — rapide
    '-y',           // overwrite sans confirmation
    outPath,
  ];
  // Si les codecs des clips sont incompatibles, on bascule en ré-encodage H.264
  if (args.reencode) {
    ffmpegArgs.splice(ffmpegArgs.indexOf('-c'), 2,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac');
  }

  try {
    await _runFfmpeg(ffmpegArgs);
  } catch (err) {
    try { fs.unlinkSync(listPath); } catch { /* ignoré */ }
    return { ok: false, error: err.message };
  }

  try { fs.unlinkSync(listPath); } catch { /* ignoré */ }

  const sizeKo = Math.round(fs.statSync(outPath).size / 1024);
  return { ok: true, content: `Vidéos fusionnées → ${outName} (${sizeKo} Ko, ${inputs.length} clips)` };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error('FFMPEG_NON_TROUVÉ — installez ffmpeg : winget install ffmpeg  (puis redémarrez l\'app)'));
      } else {
        reject(new Error(`FFMPEG_ERREUR : ${err.message}`));
      }
    });
    proc.on('close', code => {
      if (code === 0) return resolve();
      // Extraire le message d'erreur pertinent depuis stderr
      const lines  = stderr.split('\n').filter(Boolean);
      const errMsg = lines.find(l => /error|invalid|no such/i.test(l)) || lines.at(-1) || `code ${code}`;
      reject(new Error(`FFMPEG_ÉCHEC : ${errMsg.trim()}`));
    });
  });
}

module.exports = { mergeVideos };
