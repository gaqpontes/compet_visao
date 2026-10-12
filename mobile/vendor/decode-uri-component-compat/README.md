# Compatibilidade do decoder corrigido

`query-string` 7 espera que `require('decode-uri-component')` retorne uma função. A versão upstream 0.5.0 corrige GHSA-vcc3-ghjq-m6fr e mudou para ESM. Este adaptador preserva a API CommonJS, sem alterar o algoritmo upstream. `decode-uri-component-fixed` é um alias npm fixado em 0.5.0; a raiz declara essa dependência para que ela seja resolvida também no pacote local linkado pelo npm.

Os testes verificam parsing/stringify, Unicode e escapes malformados. O preset Jest mantém as exclusões Expo e transforma também o decoder ESM. Não foi forçada atualização incompatível do Expo Router.
