# RepCounter — projeto de visão computacional mobile

Aplicativo Expo/React Native para contar ciclos completos de exercícios em vídeos locais e indicar limitações da leitura. Esta branch segue a orientação da atividade: explicação técnica neste README e projeto mobile completo em `mobile/`. O notebook modelo orientou a estrutura; não é o artefato principal de entrega.

## 1. Problema e recorte

Conferir repetições em vídeos é trabalhoso e depende de observar o movimento completo. O RepCounter estima pontos corporais, calcula ângulos e identifica ciclos de flexão/retorno. Rosca, agachamento, flexão e supinos estão disponíveis; a avaliação pública descrita abaixo cobre os três primeiros. A classificação angular não certifica execução correta, segurança ou adequação clínica.

## 2. Preparação e execução

O código inclui fontes Android/iOS/Web, modelos locais e dependências fixadas no lockfile. Requisitos: Node compatível com Expo SDK 57, npm; para Android, Android Studio, SDK Android e JDK 21. A instalação inicial das ferramentas e dependências pode exigir Internet. Os recursos de inferência são locais durante o uso.

```powershell
cd mobile
npm ci
npm run prepare:offline
npm test -- --runInBand
npx tsc --noEmit
```

Web local de produção, com proteção de rede:

```powershell
npm run build:web
npm run serve:local
```

Abra `http://127.0.0.1:8081/`. Para desenvolvimento Web, `npm run web` utiliza localhost; a política CSP de desenvolvimento permite apenas a origem local e WebSocket de loopback. Não use o servidor de desenvolvimento como publicação em rede.

### Android

Configure `JAVA_HOME`, `ANDROID_HOME` e `ANDROID_SDK_ROOT` para as instalações locais. Não edite as pastas nativas geradas; a implementação mantida fica em `mobile/modules/pose-tracker/`.

```powershell
npx expo prebuild --platform android --no-install
npm run android
```

Para gerar o APK ARM64 em Windows:

```powershell
cd android
.\gradlew.bat :app:assembleRelease --no-daemon --max-workers=2 '-PreactNativeArchitectures=arm64-v8a' '-Pexpo.useLegacyPackaging=true'
```

O pacote sai em `app/build/outputs/apk/release/app-release.apk`. O empacotamento com extração das bibliotecas permite o teste ARM64 nos emuladores x86_64 com tradução ARM64; não equivale a um binário x86_64. `--offline` pode ser acrescentado depois que o cache Gradle estiver preparado. A assinatura padrão é de testes: não é assinatura de loja. Nenhuma chave privada ou APK integra esta branch. iOS está presente como fonte, mas não foi compilado ou testado nesta entrega; a resolução CocoaPods ainda não está totalmente fixada.

## 3. Dados e privacidade da publicação

A avaliação local utilizou sete vídeos públicos licenciados pelo Pexels, organizados em 14 trechos sem sobreposição. Onze trechos são comparáveis; três têm articulações necessárias fora do quadro e são mantidos como entradas inadequadas. Trechos da mesma gravação são correlacionados. O gabarito foi anotado visualmente por um observador; não há medida de concordância entre anotadores.

Por restrição de privacidade, esta branch não contém vídeos, quadros, keypoints de pessoas, fixtures reais, notebooks com dados, exemplos de entrada, gravações, logs ou histórico do repositório de desenvolvimento. Os arquivos `.task` são modelos pretreinados necessários à inferência, não dados extraídos dos participantes. Para testar a aplicação, selecione um arquivo de vídeo próprio, autorizado e já disponível no dispositivo.

As origens e os hashes dos modelos constam em `mobile/modules/pose-tracker/model-assets.json` e `web-assets.json`; o SDK é MediaPipe. A licença Pexels permite usos com restrições; não equivale a domínio público, consentimento direto ou endosso das pessoas filmadas. Referência: https://www.pexels.com/license/.

## 4. Técnica e pipeline

Vídeo local → seleção do trecho → amostragem e redução proporcional → MediaPipe Pose → pontos corporais → seleção/continuidade do lado → ângulo 3D com alternativa 2D → suavização temporal → máquina de estados com histerese e permanência nos extremos → contagem, gráfico e feedback.

O padrão é MediaPipe Full, 8 FPS, escala 1/3 e mãos desligadas na análise de vídeo. A tolerância angular ajustável começa em 20% da faixa angular configurada e recalcula a contagem sobre os mesmos pontos. Essa margem é uma escolha de produto ajustada com os casos avaliados, sem validação científica própria. A análise impõe orçamento de 4.800 amostras; vídeos de resolução extrema ainda podem consumir muita memória.

Arquivos principais:

- `mobile/src/utils/`: ângulos, continuidade, contador, avaliação do vídeo e feedback.
- `mobile/src/components/`: player, gráfico, parâmetros e resultados.
- `mobile/modules/pose-tracker/`: inferência nativa Kotlin/Swift e Web.
- `mobile/scripts/`: preparação dos recursos locais, execução Expo e servidor protegido.
- `mobile/__tests__/`: testes sintéticos; nenhum dado real de pessoa.

## 5. Avaliação e resultados

A tabela registra a revalidação do contador sobre pontos previamente extraídos. Não representa uma nova inferência realizada por este README. Os dados de entrada não são publicados: os testes sintéticos são reproduzíveis na branch, mas a tabela real exige os materiais locais de avaliação para repetição exata.

| Caso | Exercício | Referência visual | Contagem revalidada | Erro absoluto | Comparável |
|---|---|---:|---:|---:|---|
| C01 | Agachamento | 4 | 0 | — | Não; articulação fora do quadro |
| C02 | Agachamento | 5 | 0 | — | Não; articulação fora do quadro |
| C03 | Agachamento | 3 | 0 | — | Não; articulação fora do quadro |
| C04 | Rosca | 1 | 1 | 0 | Sim |
| C05 | Rosca | 2 | 0 | 2 | Sim |
| C06 | Flexão | 1 | 1 | 0 | Sim |
| C07 | Flexão | 1 | 1 | 0 | Sim |
| C08 | Flexão | 1 | 1 | 0 | Sim |
| C09 | Flexão | 1 | 1 | 0 | Sim |
| C10 | Flexão | 1 | 1 | 0 | Sim |
| C11 | Flexão | 1 | 1 | 0 | Sim |
| C12 | Flexão | 1 | 1 | 0 | Sim |
| C13 | Flexão | 1 | 1 | 0 | Sim |
| C14 | Flexão | 1 | 1 | 0 | Sim |

Nos quatro vídeos comparáveis, a revalidação com tolerância de 20% teve **erro absoluto médio de 0,50 repetição/vídeo**, com **3 de 4 contagens exatas**. A execução histórica do app teve MAE 1,25 e 1/4 contagens exatas. Uma comparação controlada em Python com a mesma máquina de estados, margem 0%, teve MAE 1,75 e 1/4 contagens exatas; a alternativa simples de dois limiares teve MAE 1,50 e 1/4. Não confundir a execução histórica com esse baseline controlado.

Os casos foram usados para ajustar a tolerância: é revalidação, sem conjunto independente, estimativa populacional ou “75% de precisão geral”. Os agachamentos não entram no MAE porque o gabarito do tronco não mede a amplitude do joelho.

No Android, a inferência completa de uma flexão confirmou quatro repetições; uma rosca apresentou uma repetição e aviso de falhas de leitura, diferindo da contagem Web histórica. Câmeras simuladas frontal/traseira foram testadas. A build final teve reprodução visual conferida; inferências completas pertencem às builds intermediárias identificadas na documentação local. Não houve teste em celular físico. O emulador com tradução ARM64 foi lento e não serve como benchmark de aparelho.

### Referências angulares

Protocolos de referência: França et al., flexão (DOI 10.5114/hm.2023.117778); Kleiber et al., cotovelo (10.3389/fphys.2015.00215); Cotter et al., agachamento (10.1519/JSC.0b013e3182773319); Rodríguez-Ridao et al., supino (10.3390/ijerph17197339). Populações/protocolos específicos não definem um ângulo universalmente correto. Perspectiva, rastreamento e tolerância limitam a interpretação; sem medir a barra/peito, o protocolo de supino pode ficar não avaliável.

## 6. Ética, segurança e limites

A aplicação processa localmente e não possui endpoint de upload. Os modelos estão empacotados; Web verifica integridade/SRI e bloqueia conexões externas por CSP. O APK remove INTERNET e ACCESS_NETWORK_STATE, desliga backup, HTTP e atualizações remotas. Exports são locais, por ação explícita; pontos corporais não são automaticamente anônimos.

O SDK MediaPipe pode tentar telemetria; os cenários protegidos bloquearam as tentativas. Não se afirma ausência de tentativas do SDK. O seletor do sistema pode apresentar provedores em nuvem: escolha somente arquivos já armazenados no dispositivo; a falta de INTERNET no app não bloqueia a rede de outros aplicativos provedores. Colab hospedado é nuvem e não integra a execução mobile local.

Cinco revisores por agentes examinaram runtime/rede, dados e histórico, dependências, entradas/arquivos e privacidade/requisitos. A revisão considerou categorias OWASP pertinentes e encontrou riscos residuais: ferramentas npm com avisos sem correção disponíveis na auditoria de 10/10/2026; dependência da CSP na Web; provedores de documentos externos; limites de memória por resolução e retenção temporária de blobs ao trocar vídeos. Não é pentest, certificação OWASP ou garantia de ausência de vulnerabilidades. Não houve captura de pacotes nem fuzzing de decodificadores. Avisos de ferramentas não foram encontrados nas inspeções anteriores dos bundles distribuídos; o risco de desenvolvimento permanece.

Instalação limpa validada: `npm ci` concluiu, **191 testes em 19 suítes** passaram e `tsc --noEmit` passou. Os testes que exigiam gravações reais foram excluídos da publicação. O export Web estático também concluiu com sucesso.

## 7. Conclusão

A contagem funcionou melhor nas flexões; oclusões, enquadramento e rastreamento instável causam subcontagem. O resultado deve informar quando a leitura não sustenta uma conclusão. Os próximos passos são avaliação independente com maior diversidade, teste em aparelhos físicos e redução dos riscos residuais documentados. A entrega em GitHub contém o código necessário, sem dados pessoais ou materiais de exemplo.

O vídeo de demonstração e o roteiro de narração são entregues separadamente, preservando a regra de não publicar gravações neste repositório.
