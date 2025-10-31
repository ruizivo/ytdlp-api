const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const DOWNLOADS_DIR = path.join(__dirname, '../downloads');
const YTDLP_PATH = path.join(__dirname, '../bin', 'yt-dlp');
const DB_PATH = path.join(__dirname, '../data', 'tasks.db');

// Inicializar banco de dados SQLite
let db;

function initDatabase() {
  // Criar diretório data se não existir
  const dataDir = path.dirname(DB_PATH);
  if (!require('fs').existsSync(dataDir)) {
    require('fs').mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  
  // Criar tabela de tasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      key_name TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      url TEXT NOT NULL,
      video_format TEXT,
      audio_format TEXT,
      output_format TEXT,
      start_time TEXT,
      end_time TEXT,
      force_keyframes INTEGER,
      duration INTEGER,
      error TEXT,
      file TEXT,
      created_at TEXT NOT NULL,
      completed_time TEXT
    )
  `);
  
  console.log('✅ Database initialized:', DB_PATH);
}

// Funções do banco de dados
function saveTask(task) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO tasks (
      task_id, key_name, task_type, status, url,
      video_format, audio_format, output_format,
      start_time, end_time, force_keyframes, duration,
      error, file, created_at, completed_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    task.task_id,
    task.key_name,
    task.task_type,
    task.status,
    task.url,
    task.video_format || null,
    task.audio_format || null,
    task.output_format || null,
    task.start_time || null,
    task.end_time || null,
    task.force_keyframes ? 1 : 0,
    task.duration || null,
    task.error || null,
    task.file || null,
    task.created_at || new Date().toISOString(),
    task.completed_time || null
  );
}

function getTask(task_id) {
  const stmt = db.prepare('SELECT * FROM tasks WHERE task_id = ?');
  const row = stmt.get(task_id);
  
  if (!row) return null;
  
  // Converter INTEGER back to boolean
  if (row.force_keyframes !== null) {
    row.force_keyframes = Boolean(row.force_keyframes);
  }
  
  return row;
}

function updateTaskStatus(task_id, status, updates = {}) {
  const task = getTask(task_id);
  if (!task) return;
  
  saveTask({
    ...task,
    status,
    ...updates
  });
}

// Middleware de autenticação
const authMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!API_KEY) {
    return res.status(500).json({ error: 'API_KEY not configured on server' });
  }
  
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  
  next();
};

// Criar diretório de downloads se não existir
async function ensureDownloadsDir() {
  try {
    await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating downloads directory:', error);
  }
}

// Executar yt-dlp
async function executeYtDlp(taskId, args) {
  return new Promise((resolve, reject) => {
    const taskDir = path.join(DOWNLOADS_DIR, taskId);
    
    const ytdlp = spawn(YTDLP_PATH, args, {
      cwd: taskDir
    });
    
    let stdout = '';
    let stderr = '';
    
    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`[${taskId}] ${data.toString()}`);
    });
    
    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`[${taskId}] ${data.toString()}`);
    });
    
    ytdlp.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
      }
    });
    
    ytdlp.on('error', (error) => {
      reject(error);
    });
  });
}

// Processar tarefa de vídeo
async function processVideoTask(task) {
  const { task_id, url, video_format, audio_format, output_format, start_time, end_time, force_keyframes } = task;
  const taskDir = path.join(DOWNLOADS_DIR, task_id);
  
  try {
    await fs.mkdir(taskDir, { recursive: true });
    
    const args = [url];
    
    // Formato de vídeo
    if (video_format) {
      args.push('-f', `${video_format}+${audio_format || 'bestaudio'}`);
    } else if (audio_format && audio_format !== 'none' && audio_format !== null) {
      args.push('-f', `bestvideo+${audio_format}`);
    } else if (audio_format === 'none' || audio_format === null) {
      args.push('-f', 'bestvideo');
    }
    
    // Formato de saída
    if (output_format) {
      args.push('--merge-output-format', output_format);
    }
    
    // Corte de tempo
    if (start_time || end_time) {
      const downloadSections = [];
      const startSec = parseTime(start_time) || 0;
      const endSec = parseTime(end_time) || '*';
      downloadSections.push(`*${startSec}-${endSec}`);
      
      args.push('--download-sections', downloadSections.join(','));
      
      if (force_keyframes) {
        args.push('--force-keyframes-at-cuts');
      }
    }
    
    // Output template
    args.push('-o', path.join(taskDir, 'video.%(ext)s'));
    
    updateTaskStatus(task_id, 'processing');
    
    await executeYtDlp(task_id, args);
    
    // Encontrar arquivo gerado
    const files = await fs.readdir(taskDir);
    const videoFile = files.find(f => f.startsWith('video.'));
    
    updateTaskStatus(task_id, 'completed', {
      completed_time: new Date().toISOString(),
      file: `/files/${task_id}/${videoFile}`
    });
    
  } catch (error) {
    console.error(`Task ${task_id} failed:`, error);
    updateTaskStatus(task_id, 'failed', {
      error: error.message,
      completed_time: new Date().toISOString()
    });
  }
}

// Processar tarefa de áudio
async function processAudioTask(task) {
  const { task_id, url, audio_format, output_format } = task;
  const taskDir = path.join(DOWNLOADS_DIR, task_id);
  
  try {
    await fs.mkdir(taskDir, { recursive: true });
    
    const args = [url, '-x'];
    
    if (audio_format) {
      args.push('--audio-format', audio_format);
    }
    
    if (output_format) {
      args.push('--audio-format', output_format);
    }
    
    args.push('-o', path.join(taskDir, 'audio.%(ext)s'));
    
    updateTaskStatus(task_id, 'processing');
    
    await executeYtDlp(task_id, args);
    
    const files = await fs.readdir(taskDir);
    const audioFile = files.find(f => f.startsWith('audio.'));
    
    updateTaskStatus(task_id, 'completed', {
      completed_time: new Date().toISOString(),
      file: `/files/${task_id}/${audioFile}`
    });
    
  } catch (error) {
    console.error(`Task ${task_id} failed:`, error);
    updateTaskStatus(task_id, 'failed', {
      error: error.message,
      completed_time: new Date().toISOString()
    });
  }
}

// Processar tarefa de live video
async function processLiveVideoTask(task) {
  const { task_id, url, duration, video_format, audio_format, output_format } = task;
  const taskDir = path.join(DOWNLOADS_DIR, task_id);
  
  try {
    await fs.mkdir(taskDir, { recursive: true });
    
    const args = [url];
    
    if (video_format) {
      args.push('-f', `${video_format}+${audio_format || 'bestaudio'}`);
    }
    
    if (duration) {
      args.push('--live-from-start', '--download-sections', `*0-${duration}`);
    }
    
    if (output_format) {
      args.push('--merge-output-format', output_format);
    }
    
    args.push('-o', path.join(taskDir, 'live_video.%(ext)s'));
    
    updateTaskStatus(task_id, 'processing');
    
    await executeYtDlp(task_id, args);
    
    const files = await fs.readdir(taskDir);
    const videoFile = files.find(f => f.startsWith('live_video.'));
    
    updateTaskStatus(task_id, 'completed', {
      completed_time: new Date().toISOString(),
      file: `/files/${task_id}/${videoFile}`
    });
    
  } catch (error) {
    console.error(`Task ${task_id} failed:`, error);
    updateTaskStatus(task_id, 'failed', {
      error: error.message,
      completed_time: new Date().toISOString()
    });
  }
}

// Processar tarefa de live audio
async function processLiveAudioTask(task) {
  const { task_id, url, duration, audio_format, output_format } = task;
  const taskDir = path.join(DOWNLOADS_DIR, task_id);
  
  try {
    await fs.mkdir(taskDir, { recursive: true });
    
    const args = [url, '-x'];
    
    if (duration) {
      args.push('--live-from-start', '--download-sections', `*0-${duration}`);
    }
    
    if (audio_format) {
      args.push('--audio-format', audio_format);
    }
    
    if (output_format) {
      args.push('--audio-format', output_format);
    }
    
    args.push('-o', path.join(taskDir, 'live_audio.%(ext)s'));
    
    updateTaskStatus(task_id, 'processing');
    
    await executeYtDlp(task_id, args);
    
    const files = await fs.readdir(taskDir);
    const audioFile = files.find(f => f.startsWith('live_audio.'));
    
    updateTaskStatus(task_id, 'completed', {
      completed_time: new Date().toISOString(),
      file: `/files/${task_id}/${audioFile}`
    });
    
  } catch (error) {
    console.error(`Task ${task_id} failed:`, error);
    updateTaskStatus(task_id, 'failed', {
      error: error.message,
      completed_time: new Date().toISOString()
    });
  }
}

// Processar tarefa de info
async function processInfoTask(task) {
  const { task_id, url } = task;
  const taskDir = path.join(DOWNLOADS_DIR, task_id);
  
  try {
    await fs.mkdir(taskDir, { recursive: true });
    
    const args = [url, '--dump-json', '--no-download'];
    
    updateTaskStatus(task_id, 'processing');
    
    const { stdout } = await executeYtDlp(task_id, args);
    
    // Salvar info.json
    const infoPath = path.join(taskDir, 'info.json');
    await fs.writeFile(infoPath, stdout);
    
    updateTaskStatus(task_id, 'completed', {
      completed_time: new Date().toISOString(),
      file: `/files/${task_id}/info.json`
    });
    
  } catch (error) {
    console.error(`Task ${task_id} failed:`, error);
    updateTaskStatus(task_id, 'failed', {
      error: error.message,
      completed_time: new Date().toISOString()
    });
  }
}

// Converter tempo para segundos
function parseTime(time) {
  if (!time) return null;
  if (typeof time === 'number') return time;
  
  const parts = time.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    return parts[0];
  }
  return null;
}

// ENDPOINTS

// POST /get_video
app.post('/get_video', authMiddleware, async (req, res) => {
  const { url, video_format, audio_format, output_format, start_time, end_time, force_keyframes } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  const task_id = uuidv4().replace(/-/g, '').substring(0, 16);
  
  const task = {
    key_name: 'user_key',
    task_id,
    task_type: 'get_video',
    status: 'waiting',
    url,
    video_format: video_format || 'bestvideo',
    audio_format: audio_format || 'bestaudio',
    output_format: output_format || 'mp4',
    start_time,
    end_time,
    force_keyframes: force_keyframes || false,
    created_at: new Date().toISOString()
  };
  
  saveTask(task);
  
  // Processar em background
  processVideoTask(task).catch(err => console.error('Error processing video task:', err));
  
  res.json({
    status: 'waiting',
    task_id
  });
});

// POST /get_audio
app.post('/get_audio', authMiddleware, async (req, res) => {
  const { url, audio_format, output_format } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  const task_id = uuidv4().replace(/-/g, '').substring(0, 16);
  
  const task = {
    key_name: 'user_key',
    task_id,
    task_type: 'get_audio',
    status: 'waiting',
    url,
    audio_format: audio_format || 'best',
    output_format: output_format || 'mp3',
    created_at: new Date().toISOString()
  };
  
  saveTask(task);
  
  processAudioTask(task).catch(err => console.error('Error processing audio task:', err));
  
  res.json({
    status: 'waiting',
    task_id
  });
});

// POST /get_live_video
app.post('/get_live_video', authMiddleware, async (req, res) => {
  const { url, duration, video_format, audio_format, output_format } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  const task_id = uuidv4().replace(/-/g, '').substring(0, 16);
  
  const task = {
    key_name: 'user_key',
    task_id,
    task_type: 'get_live_video',
    status: 'waiting',
    url,
    duration,
    video_format: video_format || 'bestvideo',
    audio_format: audio_format || 'bestaudio',
    output_format: output_format || 'mp4',
    created_at: new Date().toISOString()
  };
  
  saveTask(task);
  
  processLiveVideoTask(task).catch(err => console.error('Error processing live video task:', err));
  
  res.json({
    status: 'waiting',
    task_id
  });
});

// POST /get_live_audio
app.post('/get_live_audio', authMiddleware, async (req, res) => {
  const { url, duration, audio_format, output_format } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  const task_id = uuidv4().replace(/-/g, '').substring(0, 16);
  
  const task = {
    key_name: 'user_key',
    task_id,
    task_type: 'get_live_audio',
    status: 'waiting',
    url,
    duration,
    audio_format: audio_format || 'best',
    output_format: output_format || 'mp3',
    created_at: new Date().toISOString()
  };
  
  saveTask(task);
  
  processLiveAudioTask(task).catch(err => console.error('Error processing live audio task:', err));
  
  res.json({
    status: 'waiting',
    task_id
  });
});

// POST /get_info
app.post('/get_info', authMiddleware, async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  const task_id = uuidv4().replace(/-/g, '').substring(0, 16);
  
  const task = {
    key_name: 'user_key',
    task_id,
    task_type: 'get_info',
    status: 'waiting',
    url,
    created_at: new Date().toISOString()
  };
  
  saveTask(task);
  
  processInfoTask(task).catch(err => console.error('Error processing info task:', err));
  
  res.json({
    status: 'waiting',
    task_id
  });
});

// GET /status/:task_id
app.get('/status/:task_id', authMiddleware, (req, res) => {
  const { task_id } = req.params;
  
  const task = getTask(task_id);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  res.json(task);
});

// GET /files/:task_id/:filename
app.get('/files/:task_id/:filename', async (req, res) => {
  const { task_id, filename } = req.params;
  const { raw, qualities, ...queryParams } = req.query;
  
  const filePath = path.join(DOWNLOADS_DIR, task_id, filename);
  
  try {
    // Verificar se arquivo existe
    await fs.access(filePath);
    
    // Se for info.json, processar query params
    if (filename === 'info.json' && !raw) {
      const content = await fs.readFile(filePath, 'utf8');
      const info = JSON.parse(content);
      
      // Se solicitou qualities
      if (qualities !== undefined) {
        const formattedQualities = {
          qualities: {
            audio: {},
            video: {}
          }
        };
        
        if (info.formats) {
          info.formats.forEach(format => {
            if (format.vcodec && format.vcodec !== 'none') {
              formattedQualities.qualities.video[format.format_id] = {
                height: format.height,
                width: format.width,
                fps: format.fps,
                vcodec: format.vcodec,
                format_note: format.format_note,
                dynamic_range: format.dynamic_range,
                filesize: format.filesize
              };
            } else if (format.acodec && format.acodec !== 'none') {
              formattedQualities.qualities.audio[format.format_id] = {
                abr: format.abr,
                acodec: format.acodec,
                audio_channels: format.audio_channels,
                filesize: format.filesize
              };
            }
          });
        }
        
        return res.json(formattedQualities);
      }
      
      // Filtrar por query params
      if (Object.keys(queryParams).length > 0) {
        const filtered = {};
        Object.keys(queryParams).forEach(key => {
          if (info[key] !== undefined) {
            filtered[key] = info[key];
          }
        });
        return res.json(filtered);
      }
      
      return res.json(info);
    }
    
    // Servir arquivo normalmente
    if (raw === 'true') {
      res.download(filePath);
    } else {
      res.sendFile(filePath);
    }
    
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Inicializar servidor
async function start() {
  await ensureDownloadsDir();
  initDatabase();
  
  app.listen(PORT, () => {
    console.log(`yt-dlp API running on port ${PORT}`);
    console.log(`API_KEY configured: ${!!API_KEY}`);
    console.log(`Database: ${DB_PATH}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});