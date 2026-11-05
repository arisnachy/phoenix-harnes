# PHOENIX Genesis — demostración ejecutable y diagnóstico en consola

Objetivo: probar el funcionamiento **real** de la consola, el registro
institucional y los informes con un hospital **100% ficticio**, sin
conectar equipos, historias clínicas, personas ni datos de producción.

## Prueba reproducible desde PowerShell

En la raíz del repositorio PHOENIX, con Node.js 24 o posterior:

~~~powershell
$demo = Join-Path $env:TEMP "phoenix-genesis-demo-manual"
pnpm genesis:demo $demo
~~~

El comando requiere una **carpeta nueva**. Si ya existe, el
programa se niega a sobrescribirla: utiliza otro nombre.

Al finalizar entrega:
- \`genesis.sqlite\`: base institucional independiente.
- \`fuente_sintetica.txt\`: evidencia ficticia.
- \`diagnostico.json\`: diagnóstico con fuente SHA-256.
- \`diagnostico.html\`: informe claro, autónomo e imprimible.
- \`poa-borrador.json\`: POA de ejemplo, nunca aprobado.
- \`LEEME-DEMO.txt\`: guía para explorar la consola.

### Abrir la consola con la base de demostración

~~~powershell
$env:PHOENIX_GENESIS_DB = Join-Path $demo "genesis.sqlite"
$env:PHOENIX_GENESIS_ADMIN_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
pnpm genesis
~~~

Abre \`http://127.0.0.1:8767/\` desde **ese mismo equipo** e
introduce la clave que generaste. Selecciona
\`hospital_genesis_demo\`. Visita:

1. **Resumen:** dos sedes, siete unidades y los datos registrados.
2. **Censo hospitalario:** tres áreas evaluadas, dos respaldadas con
   evidencia ficticia, 57 sin evaluar; no declara que existan 60
   servicios reales.
3. **Diagnóstico ejecutivo:** prioridades por área, cobertura
   documental y presupuestos; descarga HTML o JSON desde la consola.
4. **Planificación:** metas e indicadores y borrador de POA.
5. **Tecnología:** HIS de demostración con integración pendiente.
6. **Red PHOENIX:** diseño LAN. Ninguna instancia está instalada ni
   conectada.

**Nota:** los 120 puestos son agregados y ficticios; las 45 camas
y 34 camas ocupadas son solamente números de prueba. No se crean
pacientes ni expedientes. Los USD y DOP son importes hipotéticos,
sin cotizaciones, y no se convierten monedas.

Si \`pnpm genesis\` ya está ejecutándose, detén esa instancia de la
consola antes de iniciar una segunda con la base ficticia; el puerto
8767 solo admite un proceso por dirección.

Al terminar la demo, cierra la consola y elimina
\`$demo\` solamente si confirmas que es la carpeta de prueba.
El generador no borra ni toca la base institucional predeterminada.

## Prompt para conversar con Kira/PHOENIX

Pega este texto en PHOENIX después de crear la demo con los comandos
anteriores, y evalúa el resultado:

> Actúa como PHOENIX Genesis. Antes de responder, verifica si tienes
> herramientas reales para leer Genesis Console o su API local.
> Investiga el hospital ficticio \`hospital_genesis_demo\` usando las
> herramientas disponibles y enumera las dos sedes, siete unidades,
> 120 puestos, 45 camas de prueba, tres áreas evaluadas, metas,
> presupuestos y prioridades. Comprueba evidencia, estados y
> un borrador de POA. No declares conectadas ni instaladas instancias
> Fabric. Si no puedes invocar la API o leer la base de Genesis desde
> el chat, dilo explícitamente y dame los pasos de la consola; no
> inventes operaciones, métricas ni acceso.

### Limitación importante

La consola Genesis es un servicio local HTTP que solo escucha
\`127.0.0.1\`; **no se convierte automáticamente en herramienta del chat
de Kira**. Este prompt es una prueba también del *enrutamiento de
herramientas*: si PHOENIX no dispone de un adaptador Genesis para
su chat, no debe afirmar que creó o consultó registros. La consola
local y el CLI sí son vías ejecutables para probar el trabajo.

Tampoco debe verse esta demostración como validación clínica o
habilitación de un hospital. Para producción faltan vault cifrado
por roles, interpretación avanzada CAD/BIM/OCR, puentes HIS reales,
autorización institucional, despliegue a estaciones y reportes
oficiales con firma y acuse.
