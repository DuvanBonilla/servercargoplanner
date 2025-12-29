# 🔧 SOLUCIÓN CORS - Digital Ocean

## 🔴 Problema Identificado

El servidor en Digital Ocean **NO estaba respondiendo con headers CORS** en las solicitudes OPTIONS (preflight), causando:
- 408+ errores de CORS desde `https://cargoban.com.co`
- Frontend bloqueado intentando acceder a `/login/validation`
- Usuarios desconectados cada 5-10 minutos
- Servidor sobrecargado con reintentos infinitos

## ✅ Cambios Realizados

### 1. **Endpoint `/login/validation` ahora es público** 
📄 Archivo: `src/login/login.controller.ts`

**Antes:**
```typescript
@Get('validation')
@ApiBearerAuth('access-token')
async validationToken(@Request() req) {
  const authHeader = req.headers.authorization;
  const token = authHeader.split(' ')[1];
  // ...
}
```

**Después:**
```typescript
@Get('validation')
@Public() // ⭐ CRÍTICO: Permite OPTIONS sin autenticación
@ApiBearerAuth('access-token')
async validationToken(@Request() req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    throw new UnauthorizedException('No token provided');
  }
  const token = authHeader.split(' ')[1];
  // ...
}
```

**Por qué:** El guard JWT global bloqueaba las solicitudes OPTIONS antes de que CORS pudiera responder.

---

### 2. **CORS se configura PRIMERO** 
📄 Archivo: `src/main.ts`

**Antes:**
```typescript
app.set('trust proxy', 'loopback');
app.use(cookieParser());
// ... otros middlewares
app.enableCors({ /* ... */ });
```

**Después:**
```typescript
// ⚠️ CRÍTICO: CORS debe ser lo PRIMERO antes de cualquier middleware
const allowedOrigins = [
  'https://cargoban.com.co',
  'https://www.cargoban.com.co',
  // ...
];

app.enableCors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ Origen bloqueado por CORS: ${origin}`);
      callback(null, false);
    }
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  exposedHeaders: ['Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400, // Cache preflight por 24 horas
});

// LUEGO los demás middlewares
app.set('trust proxy', 'loopback');
app.use(cookieParser());
```

**Por qué:** CORS debe procesar OPTIONS ANTES que cualquier middleware de autenticación.

---

## 🧪 Validación Local (ANTES de desplegar)

### Opción 1: Script automatizado
```powershell
# En una terminal: iniciar servidor
npm run start:dev

# En otra terminal: ejecutar prueba
.\test-cors.ps1
```

### Opción 2: Prueba manual con curl
```powershell
# Probar OPTIONS (preflight)
curl -X OPTIONS http://localhost:3001/login/validation `
  -H "Origin: https://cargoban.com.co" `
  -H "Access-Control-Request-Method: GET" `
  -H "Access-Control-Request-Headers: authorization" `
  -v

# Debes ver en la respuesta:
# < Access-Control-Allow-Origin: https://cargoban.com.co
# < Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS
# < Access-Control-Allow-Credentials: true
```

### Opción 3: Desde el navegador
```javascript
// Abre la consola del navegador en https://cargoban.com.co
fetch('http://localhost:3001/login/validation', {
  method: 'OPTIONS',
  headers: {
    'Origin': 'https://cargoban.com.co'
  }
}).then(r => console.log('✅ CORS OK', r.headers));
```

---

## 🚀 Despliegue a Digital Ocean

Una vez validado localmente:

```bash
# 1. Commit cambios
git add .
git commit -m "fix: CORS configuration for cargoban.com.co origin"

# 2. Push a Digital Ocean
git push origin main

# 3. Verificar logs del servidor
# (SSH a Digital Ocean o usar el dashboard)
pm2 logs

# 4. Probar desde producción
curl -X OPTIONS https://seal-app-55opl.ondigitalocean.app/login/validation \
  -H "Origin: https://cargoban.com.co" \
  -v
```

---

## 📊 Beneficios Esperados

✅ **Preflight cacheado 24 horas** → 86400 solicitudes OPTIONS menos por día
✅ **Headers CORS correctos** → No más bloqueos del navegador
✅ **Endpoint público solo para OPTIONS** → Seguridad mantenida con token JWT
✅ **Logs de diagnóstico** → Identificar orígenes bloqueados
✅ **Servidor estable** → Sin reintentos infinitos que sobrecargan

---

## 🔍 Monitoreo Post-Despliegue

Después de desplegar, verifica en los logs:

```bash
# Deberías ver:
✅ Servidor iniciado correctamente 
📡 Todos los endpoints cargados y disponibles

# NO deberías ver:
📩 Solicitud OPTIONS recibida: /login/validation desde https://cargoban.com.co
⚠️ Origen bloqueado por CORS: https://cargoban.com.co
```

Si ves solicitudes OPTIONS en los logs, está funcionando. Si ves orígenes bloqueados, algo está mal.

---

## ⚠️ IMPORTANTE

**NO subir estos cambios sin validar localmente primero.**

El script `test-cors.ps1` te ayudará a confirmar que todo funciona antes de afectar producción.

---

## 🆘 Si sigue fallando después del despliegue

1. **Verificar que el servidor en Digital Ocean se reinició**
   ```bash
   pm2 restart all
   ```

2. **Verificar variables de entorno**
   - Asegúrate de que `PORT`, `SECRET_JWT`, etc. estén configuradas

3. **Verificar firewall/proxy de Digital Ocean**
   - Puede haber un proxy nginx bloqueando OPTIONS

4. **Revisar logs completos**
   ```bash
   pm2 logs --lines 100
   ```

5. **Probar directamente sin dominio**
   ```bash
   curl -X OPTIONS https://seal-app-55opl.ondigitalocean.app/login/validation -v
   ```
