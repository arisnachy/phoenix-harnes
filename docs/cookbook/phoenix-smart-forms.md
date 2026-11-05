# PHOENIX · Formularios inteligentes y biblioteca

La conversación incorpora dos contratos nativos de UI generativa: smart_form para calculadoras, cuestionarios, test, escalas y formularios; smart_form_library para explorar y recuperar plantillas y resultados.

El modelo entrega JSON declarativo en un bloque Markdown etiquetado generative-ui. No se ejecuta JavaScript, HTML, scripts ni callbacks del modelo. Los valores se calculan localmente sin un nuevo turno de IA.

## Ejemplo de definición JSON

~~~json
{
  "component":"smart_form","version":1,
  "props":{
    "id":"area_rectangulo","title":"Área del rectángulo","kind":"calculator",
    "folder":"Ciencia/Geometría","source":"Geometría elemental",
    "fields":[
      {"id":"base","label":"Base","type":"number","min":0.01,"unit":"cm"},
      {"id":"alto","label":"Altura","type":"number","min":0.01,"unit":"cm"}
    ],
    "outputs":[{
      "id":"area","label":"Área","unit":"cm²","precision":2,
      "expression":{"op":"mul","args":[{"field":"base"},{"field":"alto"}]}
    }]
  }
}
~~~

## Capacidades y límites

Categorías: calculator, scientific, test, scale, survey, form.

Tipos de campo: number, range, text, textarea, date, time, select, radio, checkbox. Se admiten valores predeterminados, unidades, restricciones numéricas, opciones, campos opcionales y visualización condicional con showWhen.

Las expresiones JSON pueden usar constantes, referencias a campos y la fecha local actual. Los operadores admitidos son:
- Aritmética: add, sub, mul, div, pow, mod, min, max, abs, floor, ceil, round, neg.
- Científicos: sqrt, ln, log10, exp, sin, cos, tan, pi. Los ángulos trigonométricos se expresan en radianes.
- Lógica: eq, neq, gt, gte, lt, lte, and, or, not, if.
- Fechas: days_between y add_days (días calendario).

Las expresiones tienen la forma: {"op":"add","args":[{"field":"x"},{"constant":2}]}.
Los casos fuera del dominio matemático producen un error visible, nunca Infinity o NaN. Se admiten hasta 80 campos, 18 salidas, 14 niveles y 350 nodos; no se aceptan claves no reconocidas.

Un test o escala puede sumar los valores numéricos de sus opciones y declarar umbrales en outputs.bands mediante una lista ordenada de {"max":n,"label":"texto"}. La interpretación es solo la declarada y nunca equivale por sí sola a validación clínica.

## Biblioteca, carpetas, revisiones e índice

1. Pedir: «Kira, crea una calculadora o formulario interactivo como smart_form, con ID, campos, salidas y fuente». El modelo devuelve un bloque generative-ui.
2. Abrir el formulario y usar Guardar plantilla. Su carpeta se puede definir como Salud/Obstetricia, Educación/Encuestas o Administración/Finanzas.
3. Abrir la biblioteca mediante el objeto {"component":"smart_form_library","version":1,"props":{}}. Buscar por título, ID, carpeta o etiquetas.
4. Usar Modificar con Kira o Mejorar con Kira para enviar la definición exacta a la conversación. Conservar el ID al revisar y volver a Guardar plantilla para incrementar la revisión.
5. Cuando se completen los campos, Guardar resultado exige autorización explícita para guardar respuestas y resultados. Resultados muestra el historial y permite solicitar un análisis a Kira.
6. Exportar e importar el JSON de la biblioteca permite hacer copias de las definiciones. El archivo exportado excluye respuestas y datos guardados de personas.
7. Compartir índice con Kira envía los títulos y metadatos de plantillas del navegador al cuadro de diálogo; Kira puede pedir entonces la definición completa.

La primera implementación guarda en localStorage del perfil del navegador. Las carpetas son rutas lógicas dentro de esta biblioteca, no directorios del sistema de archivos. No existe sincronización con el Host, búsqueda automática del índice por parte del agente, cifrado, soporte multiusuario ni copias de seguridad automáticas. No hay que presentar esta versión como un repositorio clínico persistente compartido.

Ejemplos iniciales: índice de masa corporal en adultos, estimación obstétrica por FUM, calculadora científica y encuesta Likert pedagógica no validada.

## Seguridad y avance de la plataforma

No guardar datos personales identificables ni expedientes clínicos en el almacenamiento local del navegador. Verificar la fuente, versión, licencia, idioma, población y puntos de corte de escalas clínicas antes de utilizarlas para decisiones. El IMC de adulto y la FUM son estimaciones, no diagnósticos.

La siguiente etapa conectará definiciones y resultados al Host mediante herramientas del agente list/search/get/create/revise/run, con permisos por usuario/institución, cifrado, auditoría, versiones inmutables y compatibilidad opcional con FHIR Questionnaire y QuestionnaireResponse. Hasta que esa capa esté implementada, el agente solo puede conocer el índice o la definición cuando el usuario pulsa el botón correspondiente.
