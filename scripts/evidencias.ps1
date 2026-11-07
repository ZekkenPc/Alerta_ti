# Pruebas de la API para PowerShell (Windows). Requiere el backend corriendo en otra ventana (npm start).
# Uso:  powershell -ExecutionPolicy Bypass -File .\scripts\evidencias.ps1
param([string]$Base = "http://localhost:3000")

function Llamar($titulo, $metodo, $ruta, $token, $cuerpo) {
  Write-Host ""
  Write-Host ">>> $titulo" -ForegroundColor Cyan
  Write-Host "    $metodo $ruta" -ForegroundColor DarkGray
  $h = @{}
  if ($token) { $h["Authorization"] = "Bearer $token" }
  $p = @{ Uri = "$Base$ruta"; Method = $metodo; Headers = $h; UseBasicParsing = $true }
  if ($cuerpo) { $p["Body"] = $cuerpo; $p["ContentType"] = "application/json" }
  try {
    $r = Invoke-WebRequest @p
    $codigo = [int]$r.StatusCode; $texto = $r.Content
  } catch {
    $resp = $_.Exception.Response
    if (-not $resp) { Write-Host "    No hay conexion con el servidor. Esta corriendo npm start?" -ForegroundColor Red; return $null }
    $codigo = [int]$resp.StatusCode
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $texto = $_.ErrorDetails.Message }
    else { $texto = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() }
  }
  $color = if ($codigo -lt 300) { "Green" } else { "Yellow" }
  Write-Host "    HTTP $codigo" -ForegroundColor $color
  try { $json = $texto | ConvertFrom-Json } catch { $json = $null }
  return [pscustomobject]@{ Codigo = $codigo; Texto = $texto; Json = $json }
}

$r = Llamar "Health check" GET "/api/health"
$r.Texto
$r = Llamar "Practica 3: consulta de informacion" GET "/api/info"
$r.Json | ConvertTo-Json -Depth 5

$r = Llamar "Ruta protegida sin token (debe dar 401)" GET "/api/incidentes"
$r.Texto
$r = Llamar "Login con clave incorrecta (debe dar 401)" POST "/api/auth/login" $null '{"usuario":"coordinador","clave":"Mala12345"}'
$r.Texto
$r = Llamar "Login con usuario solo espacios (debe dar 400)" POST "/api/auth/login" $null '{"usuario":"   ","clave":"Coord#2026"}'
$r.Texto

$r = Llamar "Login coordinador correcto" POST "/api/auth/login" $null '{"usuario":"coordinador","clave":"Coord#2026"}'
$tc = $r.Json.token
$r.Json.token = $r.Json.token.Substring(0, 25) + "...(recortado)"
$r.Json | ConvertTo-Json -Depth 5
$r = Llamar "Login tecnico correcto" POST "/api/auth/login" $null '{"usuario":"tecnico1","clave":"Tecnico#2026"}'
$tt = $r.Json.token

$r = Llamar "Incidentes filtrados por severidad P1" GET "/api/incidentes?severidad=P1" $tt
"Total: $($r.Json.total)"
$r.Json.incidentes | Select-Object id, severidad, servidor, titulo | Format-Table -AutoSize
$r = Llamar "Filtro invalido (debe dar 400)" GET "/api/incidentes?severidad=X" $tt
$r.Texto
$r = Llamar "Resumen del dashboard" GET "/api/resumen" $tt
$r.Json | ConvertTo-Json -Depth 5
$r = Llamar "Servidores" GET "/api/servidores" $tt
$r.Json.servidores | Select-Object nombre, estado | Format-Table -AutoSize

$nuevo = '{"titulo":"Prueba de alerta","servidor":"APP-WEB-01","severidad":"P1"}'
$r = Llamar "Tecnico intenta crear incidente (debe dar 403)" POST "/api/incidentes" $tt $nuevo
$r.Texto
$r = Llamar "Coordinador crea incidente (debe dar 201)" POST "/api/incidentes" $tc $nuevo
$r.Json | ConvertTo-Json -Depth 5
$r = Llamar "El nuevo incidente aparece primero" GET "/api/incidentes" $tt
$r.Json.incidentes | Select-Object -First 3 id, severidad, servidor, titulo | Format-Table -AutoSize
