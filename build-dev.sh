#!/usr/bin/env sh
# Wraps index.html in the same skeleton the artifact host adds, for local testing.
{
  echo '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}[hidden]{display:none!important}img{max-width:100%}</style></head><body>'
  cat index.html
  echo '</body></html>'
} > dev.html
echo "wrote dev.html"
