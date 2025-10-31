# yt-dlp API Server

API REST em Node.js para yt-dlp rodando em Docker Alpine.

## 🚀 Features

- ✅ Download de vídeos com qualidade customizável
- ✅ Extração de áudio
- ✅ Suporte a live streams (vídeo e áudio)
- ✅ Corte de vídeos com timestamps
- ✅ Extração de metadados (info.json)
- ✅ Sistema de tarefas assíncronas com **SQLite persistente**
- ✅ Autenticação via API Key
- ✅ Tarefas sobrevivem a restarts do container
- ✅ Imagem Docker otimizada (~150-280MB)

## 📦 Instalação

### Escolha sua versão:

**Versão COMPLETA (com ffmpeg)** - ~300MB
- ✅ Merge automático de vídeo + áudio
- ✅ Suporta todos os formatos
- ✅ Recomendado para uso geral

**Versão SLIM (sem ffmpeg)** - ~60-70MB  
- ✅ Imagem 5x menor
- ❌ Sem merge (baixe formatos já prontos como mp4/webm com áudio)
- ✅ Ideal para containers com recursos limitados

### 1. Clone o repositório

```bash
git clone <repo>
cd ytdlp-api
```

### 2. Configure a API Key

```bash
cp .env.example .env
# Edite .env e adicione sua API_KEY
```

### 3. Build e Start

**Versão COMPLETA:**
```bash
docker-compose up -d --build
```

**Versão SLIM:**
```bash
docker-compose --profile slim up ytdlp-api-slim -d --build
```

Ou manualmente:

```bash
# Completa
docker build -t ytdlp-api -f Dockerfile .

# Slim
docker build -t ytdlp-api-slim -f Dockerfile.slim .

docker run -d -p 3000:3000 -e API_KEY=seu-segredo ytdlp-api
```

## 🔧 Uso

### Autenticação

Todas as requisições (exceto `/health` e `/files`) requerem o header:

```
X-API-Key: seu-segredo
```

### Endpoints

#### 1. Download de Vídeo

```bash
POST /get_video
Content-Type: application/json
X-API-Key: seu-segredo

{
  "url": "https://youtu.be/dQw4w9WgXcQ",
  "video_format": "bestvideo[height<=1080]",
  "audio_format": "bestaudio[abr<=129]",
  "output_format": "mp4",
  "start_time": "00:00:30",
  "end_time": "00:01:00",
  "force_keyframes": false
}
```

**Resposta:**
```json
{
  "status": "waiting",
  "task_id": "abc123def456"
}
```

#### 2. Download de Áudio

```bash
POST /get_audio
Content-Type: application/json
X-API-Key: seu-segredo

{
  "url": "https://youtu.be/dQw4w9WgXcQ",
  "audio_format": "best",
  "output_format": "mp3"
}
```

#### 3. Captura de Live Stream (Vídeo)

```bash
POST /get_live_video
Content-Type: application/json
X-API-Key: seu-segredo

{
  "url": "https://www.youtube.com/watch?v=live_stream_id",
  "duration": 300,
  "video_format": "bestvideo",
  "audio_format": "bestaudio",
  "output_format": "mp4"
}
```

#### 4. Captura de Live Stream (Áudio)

```bash
POST /get_live_audio
Content-Type: application/json
X-API-Key: seu-segredo

{
  "url": "https://www.youtube.com/watch?v=live_stream_id",
  "duration": 300,
  "audio_format": "best",
  "output_format": "mp3"
}
```

#### 5. Obter Metadados

```bash
POST /get_info
Content-Type: application/json
X-API-Key: seu-segredo

{
  "url": "https://youtu.be/dQw4w9WgXcQ"
}
```

#### 6. Verificar Status da Tarefa

```bash
GET /status/abc123def456
X-API-Key: seu-segredo
```

**Resposta:**
```json
{
  "key_name": "user_key",
  "status": "completed",
  "task_type": "get_video",
  "url": "https://youtu.be/dQw4w9WgXcQ",
  "completed_time": "2024-01-01T12:00:00.000Z",
  "file": "/files/abc123def456/video.mp4"
}
```

Status possíveis: `waiting`, `processing`, `completed`, `failed`

#### 7. Download de Arquivo

```bash
GET /files/abc123def456/video.mp4
```

**Query params opcionais:**
- `raw=true` - Força download do arquivo
- Para `info.json`:
  - `qualities` - Retorna qualidades formatadas
  - Qualquer chave do JSON (ex: `title`, `duration`) - Filtra campos

**Exemplo com qualities:**
```bash
GET /files/abc123def456/info.json?qualities
```

**Resposta:**
```json
{
  "qualities": {
    "audio": {
      "249": {
        "abr": 47,
        "acodec": "opus",
        "audio_channels": 2,
        "filesize": 528993
      }
    },
    "video": {
      "394": {
        "height": 144,
        "width": 256,
        "fps": 25,
        "vcodec": "av01.0.00M.08",
        "format_note": "144p",
        "filesize": 1009634
      }
    }
  }
}
```

#### 8. Health Check

```bash
GET /health
```

## 📋 Parâmetros Detalhados

### get_video

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| url | string | ✅ | URL do vídeo |
| video_format | string | ❌ | Formato de vídeo (ex: `bestvideo[height<=1080]`) |
| audio_format | string | ❌ | Formato de áudio ou `none` para sem áudio |
| output_format | string | ❌ | Container final (mp4, mkv, webm) |
| start_time | string/number | ❌ | Início do corte (HH:MM:SS ou segundos) |
| end_time | string/number | ❌ | Fim do corte (HH:MM:SS ou segundos) |
| force_keyframes | boolean | ❌ | Corte preciso (mais lento) |

### get_audio

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| url | string | ✅ | URL do vídeo/áudio |
| audio_format | string | ❌ | Formato do áudio |
| output_format | string | ❌ | Formato de saída (mp3, m4a, opus) |

### get_live_video / get_live_audio

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| url | string | ✅ | URL da live |
| duration | number | ❌ | Duração da captura em segundos |
| video_format | string | ❌ | Formato de vídeo (apenas live_video) |
| audio_format | string | ❌ | Formato de áudio |
| output_format | string | ❌ | Container/formato final |

## 🛠️ Desenvolvimento

```bash
# Instalar dependências
npm install

# Rodar em modo dev
npm run dev

# Ou diretamente
node server.js
```

## 🔒 Segurança

- ⚠️ Sempre use HTTPS em produção
- ⚠️ Mantenha a API_KEY segura e complexa
- ⚠️ Considere rate limiting para produção
- ⚠️ Configure volumes para persistência de downloads

## 📝 Notas

- Tarefas são armazenadas sqlite
- Arquivos ficam em `/app/downloads/<task_id>/`
- Use volumes para persistir downloads

## 🐛 Troubleshooting

**Erro 401**: Verifique se o header `X-API-Key` está correto

**Erro 500**: Verifique se a variável `API_KEY` está configurada

**Download falha**: Verifique logs com `docker logs ytdlp-api`

**Sem áudio no vídeo**: Use `audio_format: "none"` para vídeo sem áudio

## 📄 Licença

MIT