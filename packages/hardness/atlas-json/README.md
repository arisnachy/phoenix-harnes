# `@deepseek-ai/dsh-hardness-atlas-json`

English | [中文](README.zh.md)

Proveedor host-side de persistencia JSON atómica para el snapshot de HARDNESS.

Valida `formatVersion`, conserva el último archivo válido durante una escritura interrumpida y diferencia corrupción de un inventario vacío. No guarda credenciales ni concede permisos.

## Model Experience

El modelo recibe un inventario durable y verificable del Tool Atlas sin acceso directo al archivo de persistencia ni a secretos.

## Known Limitations and Deferred Work

- La integración automática con el ciclo de vida de `HardnessRegistry` y los adaptadores de herramientas se incorporan en fases posteriores.
