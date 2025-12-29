# Script para probar CORS localmente antes de desplegar

Write-Host "`n=== TEST CORS - VALIDACION LOCAL ===" -ForegroundColor Cyan

# Esperar a que el usuario inicie el servidor
Write-Host "`n[1] Asegurate de que el servidor este corriendo en http://localhost:3001" -ForegroundColor Yellow
Write-Host "    Ejecuta en otra terminal: npm run start:dev`n" -ForegroundColor Gray

Read-Host "Presiona Enter cuando el servidor este listo"

Write-Host "`n[2] Probando solicitud OPTIONS (preflight)..." -ForegroundColor Yellow

$headers = @{
    "Origin" = "https://cargoban.com.co"
    "Access-Control-Request-Method" = "GET"
    "Access-Control-Request-Headers" = "authorization"
}

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/login/validation" -Method OPTIONS -Headers $headers -UseBasicParsing -TimeoutSec 5
    
    Write-Host "[OK] Respuesta recibida:" -ForegroundColor Green
    Write-Host "     Status: $($response.StatusCode)" -ForegroundColor White
    
    # Verificar headers CORS
    $corsHeaders = @(
        "Access-Control-Allow-Origin",
        "Access-Control-Allow-Methods",
        "Access-Control-Allow-Headers",
        "Access-Control-Allow-Credentials"
    )
    
    Write-Host "`n[Headers CORS en la respuesta]:" -ForegroundColor Cyan
    foreach ($header in $corsHeaders) {
        $value = $response.Headers[$header]
        if ($value) {
            Write-Host "  [OK] $header : $value" -ForegroundColor Green
        } else {
            Write-Host "  [X]  $header : NO PRESENTE" -ForegroundColor Red
        }
    }
    
    Write-Host "`n[3] Probando solicitud GET real..." -ForegroundColor Yellow
    
    $getError = $null
    try {
        $getResponse = Invoke-WebRequest -Uri "http://localhost:3001/login/validation" -Method GET -Headers @{"Origin" = "https://cargoban.com.co"} -UseBasicParsing -TimeoutSec 5 -ErrorVariable getError
        Write-Host "[OK] GET sin token funciono (esperado: error 401)" -ForegroundColor Green
    }
    catch {
        if ($_.Exception.Response.StatusCode -eq 401) {
            Write-Host "[OK] GET sin token retorno 401 (correcto)" -ForegroundColor Green
        }
        else {
            Write-Host "[Warn] Error inesperado: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    
    Write-Host "`n[OK] PRUEBA COMPLETADA" -ForegroundColor Green
    Write-Host "Si ves headers CORS correctos, puedes desplegar a Digital Ocean con confianza." -ForegroundColor Cyan
}
catch {
    Write-Host "[ERROR] Error en la prueba:" -ForegroundColor Red
    Write-Host "        $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`nPosibles causas:" -ForegroundColor Yellow
    Write-Host "  - El servidor no esta corriendo" -ForegroundColor Gray
    Write-Host "  - El servidor esta en otro puerto" -ForegroundColor Gray
    Write-Host "  - Error en la configuracion CORS" -ForegroundColor Gray
}

Write-Host "`n"
