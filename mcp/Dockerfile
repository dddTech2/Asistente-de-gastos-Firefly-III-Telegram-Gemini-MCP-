# MCP server de Firefly III (historia 4.1) — @firefly-iii-mcp/server, en modo
# multi-tenant puro: sin PAT ni URL de Firefly III fijos en la imagen ni en el
# contenedor. Cada request trae sus propias credenciales por header (ver
# mcp/README.md). No existe imagen oficial publicada por el proyecto upstream
# (ver "Desviación de alcance documentada" en el Dev Agent Record de 4.1).
FROM node:20-alpine

RUN npm install -g @firefly-iii-mcp/server@1.4.0

EXPOSE 3000

ENTRYPOINT ["firefly-iii-mcp-server"]
# --logLevel info (no "debug"): el nivel debug de esta librería puede volcar
# headers de request completos, incluyendo Authorization -- ver AC #5.
CMD ["--port", "3000", "--logLevel", "info"]
