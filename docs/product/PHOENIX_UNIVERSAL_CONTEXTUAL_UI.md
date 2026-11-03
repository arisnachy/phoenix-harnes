# Phoenix Universal — Superficies por intención, no módulos fijos

**Estado:** regla de producto implementada para el inicio neutro.
**Alcance:** interfaz global, motor universal de herramientas, Kira y aplicaciones contextuales.

## Invariante

Phoenix no es una aplicación de investigación, medicina, juegos, redes sociales, negocios
ni ninguna otra especialidad. Es un entorno de propósito general con capacidades
descubribles y ejecutables según la intención. Agregar una herramienta o integrar
un conector **nunca añade botones permanentes a la pantalla principal**.

La pantalla inicial muestra identidad, saludo, compositor universal, espacio de
trabajo y atención proactiva real. No contiene entradas rígidas APA, Vancouver,
artículo científico ni futuras especializaciones. Se respeta el compositor
preexistente y no se duplica la caja de chat.

## Resolución contextual

1. El usuario plantea cualquier intención en lenguaje natural.
2. Kira identifica objetivo, contexto y restricciones, consultando el registro
   de herramientas/ conectores disponibles y permisos reales.
3. Escoge la capacidad adecuada sin exigir selección previa de un dominio.
4. Cuando aportan valor, se muestran **durante esa misión** los controles
   especializados: editor de portada, planificador, visor 3D, formulario, gráfica,
   navegador, gestión de negocio, etc. Si no son necesarios, no se muestran.
5. Al terminar/cambiar de misión, las vistas efímeras se cierran. El usuario
   puede solicitar una vista de forma explícita cuando lo desee.

Los controles contextuales deben solicitar los mínimos datos que falten, evitar
repeticiones y conservar los aportados previamente. No deben convertirse en un
nuevo menú permanente, otra barra fija o un conjunto de botones por integración.

## Criterios verificables

- El Hero no recibe callbacks específicos como onResearchSelect, onGameSelect
  ni onBusinessSelect.
- Las capacidades científicas siguen registradas como herramientas invocables
  por Kira; eliminarlas del Hero **no** elimina el trabajo del Research Studio.
- Una integración nueva no modifica el Hero salvo que mejore una función
  universal (accesibilidad, espacio de trabajo, saludo o compositor).
- Las interfaces de cada capacidad se pueden probar aisladamente y enlazar
  únicamente a sesiones relevantes; no se activan por heurísticas de palabras
  sin contexto o autorización.
- El estado de herramientas y conectores es real; se diferencia instalado,
  autorizado, disponible, bloqueado y ejecutado. No se finge autonomía.
- El principio se aplica también a futuros agentes, herramientas y negocios.

## Próximo punto de extensión

El mecanismo genérico de superficies contextuales debe consumir un contrato
de interfaz de la tarea o del registro universal de capacidades, no una lista
estática de dominios en el Hero. El editor especializado de portada del PR de
Research Studio no debe montarse globalmente. Su presentación contextual
requiere el contrato de tareas; hasta entonces Kira puede usar las herramientas
científicas mediante conversación normal, sin botones fijos.

Este cambio corrige el inicio. No afirma que un motor completo de renderizado
contextual esté implementado únicamente por suprimir esos botones.
