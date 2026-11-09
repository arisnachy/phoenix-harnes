# 2026-11-09 · Replay real + selección de candidatos antes del cierre + monitor cloud opt-in

Observado: el motor seleccionaba a partir de historial antes de comprobar el especialista de cada pata; la auditoría posterior criticaba pero no ofrecía sustitución real. Seguimiento de comprobantes era local en el navegador y nunca podía mandar correo con la PC apagada.

Implementación: hook de revisión previo al `diversifiedSportsPicks`, con hasta 12 candidatos. `evidencePricedTicket` llama los especialistas antes de seleccionar, penaliza pasos críticos pendientes, excluye identidades en conflicto, y reusa o reintenta expedientes; se auditan las alternativas. Un CI runner reproduce de verdad el pipeline público con métricas por endpoint y estatus de especialistas. Tests simulan exclusión y sustitución.

Monitor remoto: ciphertext AES-GCM en GitHub Issues solo con opt-in, cron en GitHub Actions, comprobación ESPN exacta por evento/fecha, reglas por mercado y correo Resend con idempotencia. El user debe aportar secrets separados, configura el remitente verificado y debe probar envío: código no equivale a activación. No se puede asegurar envío con credenciales inexistentes. La principal ruta de generación y recibos vinculados se integran sin introducir claves en prompts.

La rentabilidad y la precisión porcentual requieren backtest cronológico y estimaciones calibradas; no hay garantía de ticket ganador ni se deben fabricar pronósticos.