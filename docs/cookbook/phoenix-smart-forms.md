# PHOENIX smart forms and local library

English | [中文](phoenix-smart-forms.zh.md)

Native generative UI supports smart_form for calculators, assessments and questionnaires, and
smart_form_library for reusable definitions. A model emits declarative JSON inside a
generative-ui Markdown fence. There is no arbitrary JavaScript evaluation or network request for
local calculation.

## Minimal JSON definition

~~~json
{
  "component":"smart_form","version":1,
  "props":{
    "id":"rectangle_area","title":"Rectangle area","kind":"calculator",
    "folder":"Science/Geometry","source":"Elementary geometry",
    "fields":[
      {"id":"width","label":"Width","type":"number","min":0.01,"unit":"cm"},
      {"id":"height","label":"Height","type":"number","min":0.01,"unit":"cm"}
    ],
    "outputs":[{
      "id":"area","label":"Area","unit":"cm²","precision":2,
      "expression":{"op":"mul","args":[{"field":"width"},{"field":"height"}]}
    }]
  }
}
~~~

## Working calculations versus visual-only HTML

For a calculator, clinical scale, questionnaire score or test, emit `smart_form`
with **at least one** `outputs[].expression` referencing an input field.
Inputs, a "Calculate" button and CSS alone are *not* an executable calculator.
PHOENIX rejects calculator/scale definitions without a real formula rather
than silently displaying an empty or hard-coded result.

The chat HTML artifact viewer can also recover an embedded native declaration:

~~~html
<form><label>Width <input type="number" name="width"></label></form>
<script type="application/vnd.phoenix.smart-form+json">
{"component":"smart_form","version":1,"props":{"id":"area","title":"Area","kind":"calculator","fields":[{"id":"width","label":"Width","type":"number"},{"id":"height","label":"Height","type":"number"}],"outputs":[{"id":"double_width","label":"Double width","expression":{"op":"mul","args":[{"field":"width"},{"constant":2}]}}]}}
</script>
~~~

The JSON declaration is parsed using the same allowlisted expression runtime,
not evaluated as JavaScript. The viewer restores the built-in BMI formula for
an unmistakable legacy static BMI form with two labelled numeric inputs.
Other HTML forms without executable math show an explicit warning instead of
claiming that a visible button performed a calculation. HTML with authored
JavaScript retains its isolated script sandbox; syntax or runtime errors still
need ordinary app tests. The data stays browser-local unless the user explicitly
chooses to save a result.

## Supported controls and expressions

- Kinds: calculator, scientific, test, scale, survey, form.
- Inputs: number, range, text, textarea, date, time, select, radio, checkbox. Conditional
  display uses showWhen.
- Arithmetic: add, sub, mul, div, pow, mod, min, max, abs, floor, ceil, round, neg.
- Scientific: sqrt, ln, log10, exp, sin, cos, tan, pi. Trigonometric angles use radians.
- Logic: eq, neq, gt, gte, lt, lte, and, or, not, if.
- Calendar days: days_between, add_days.

Expressions are nested JSON objects with op and args, field references, constants or today.
Invalid domains yield explicit errors, not Infinity or NaN. Parser bounds include 80 fields, 18
outputs, 14 levels, 350 expression nodes, and a strict key allowlist.

## Library, revision history and index

- Save a definition explicitly with Save template; select a logical folder such as
  Health/Obstetrics.
- Search the local catalog by title, identifier, folder or tags. A definition with the same ID
  creates another revision, retaining up to ten previous versions.
- Use Improve with Kira to draft a new definition from the current one. The model must retain
  the ID for revisions; the user explicitly saves the new version.
- Saving answers and results requires checking the consent box. Results can be reviewed and
  submitted for analysis only through deliberate button clicks.
- Export and import a versioned JSON definition library. General exports exclude answer
  histories.
- Share index with Kira sends the local metadata to a user-reviewable draft; agents cannot
  autonomously discover browser-local templates.

Starter examples include adult BMI, obstetric last-menstrual-period dating, scientific
calculations, and a fictional Likert survey. They are illustrations, not clinical-grade
instruments.

## Persistence, privacy and future integration

Definitions, folder labels, version snapshots and optional responses are stored only in this
browser profile via localStorage. This is not an operating-system directory, a secure clinical
record, encrypted persistence, or cross-device synchronization. Avoid patient identifiers and
sensitive clinical data.

A future Host-side library should expose authorized agent list/search/get/create/revise/run
tools with audit trails, access control, encryption and optional FHIR Questionnaire and
QuestionnaireResponse exchange. Verify the provenance, clinical version, licensing, population
and cutoffs of any instrument before use.
