# Motor de conflitos

O motor **encontra** tensões. Ele não resolve, não escolhe vencedores e não
corrige o usuário.

## Tipos

| Tipo                      | O que é                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `complement`              | não é conflito; ângulos que se somam                             |
| `minor_divergence`        | diferença pequena de ênfase ou formulação                        |
| `factual_conflict`        | fatos incompatíveis: datas, lugares, ordem, quem estava presente |
| `interpretive_divergence` | a mesma experiência lida de formas diferentes                    |
| `source_conflict`         | duas fontes da biblioteca se contradizem entre si                |

## Severidade e bloqueio

`low` registra e segue. `medium` pede decisão. `high` **bloqueia**: quando há
conflito factual de severidade alta sem resolução, `buildContextPack` lança erro
e a geração não acontece. A sessão vai para `needs_conflict_review` e a mesa
mostra o aviso.

## Exemplos

**Conflito factual.** A fala diz "isso foi em 2024"; a memória confiável diz
"agosto de 2025". O sistema mostra os dois registros lado a lado e escreve
_"o sistema não corrige sozinho: a decisão é sua"_. Nunca substitui a data em
silêncio.

**Divergência interpretativa.** A fala sustenta uma posição; textos anteriores
tratam o tema de outra forma. A mensagem é
_"foram encontrados registros anteriores que tratam o tema de forma diferente"_
— nunca _"você está errado"_. Há teste automatizado para essa frase.

**Conflito entre fontes.** "A Permanência" diz que o silêncio sustenta;
"O Silêncio que Abandona" diz que o silêncio é omissão. Registra-se
`source_conflict` e **as duas continuam no dossiê**. O motor não escolhe.

## Autoridade

Uma fonte de nível 5 não anula automaticamente uma anotação de nível 2. A
autoridade influencia o ranking e a análise; a divergência continua visível.

## As seis decisões humanas

| Decisão               | Efeito no Context Pack                           |
| --------------------- | ------------------------------------------------ |
| `keep_speech`         | a fala prevalece                                 |
| `use_memory`          | o registro da memória prevalece                  |
| `treat_as_complement` | deixa de ser tratado como contradição            |
| `treat_as_evolution`  | é lido como mudança de posição ao longo do tempo |
| `manual_edit`         | o texto que você escreveu entra literalmente     |
| `ignore_source`       | a fonte sai desta investigação (só desta)        |

Toda decisão vira uma linha em `conflict_resolutions` com autor e data, e chega
ao escritor como **ordem**, não sugestão.

## Modo demonstração

Sem modelo de linguagem, as heurísticas em
`src/services/investigation/heuristics.ts` detectam divergência de ano,
inversão de polaridade e contradição entre fontes com vocabulário próximo. São
deliberadamente conservadoras: preferem classificar como complemento a inventar
uma contradição.
