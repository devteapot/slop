
MCP vs SLOP Benchmark
=====================
Mode: agent
Scenarios: explore-and-act, triage, bulk-update, scale-triage
Iterations: 3

--- Agent Mode ---

  Running agent scenario: explore-and-act
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: triage
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: bulk-update
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: scale-triage (large dataset)
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...
# MCP vs SLOP Benchmark Results

**Date:** 2026-04-01T18:51:06.163Z
**Platform:** darwin arm64
**Mode:** agent
**Iterations:** 3
**Model:** gemini-2.5-flash ($0.15/M input, $0.6/M output)

### explore-and-act (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 5        | 2        | 2          | -60%     |
| Messages received | 5        | 2        | 2          | -60%     |
| Bytes sent        | 454 B    | 291 B    | 291 B      | -36%     |
| Bytes received    | 1.5 KB   | 350 B    | 350 B      | -77%     |
| Total payload     | 2.0 KB   | 641 B    | 641 B      | -68%     |
| Setup time (ms)   | 59.27    | 2.96     | 1.44       | -98%     |
| Total time (ms)   | 10507.7  | 3152.13  | 2774.18    | -74%     |
| Input tokens      | 6863     | 14359    | 15185      | +109%    |
| Output tokens     | 124      | 62       | 62         | -50%     |
| Total tokens      | 6987     | 14421    | 15247      | +106%    |
| Tool calls        | 5        | 2        | 2          | -60%     |
| LLM round trips   | 6        | 2        | 3          | -67%     |
| Est. cost (USD)   | $0.0011  | $0.0022  | $0.0023    | +98%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 10438.98 | 3147.36   | 2771.8          |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0011  | $0.0022  | $0.0023    | +110%             |
| GPT-4.1 nano     | $0.736m  | $0.0015  | $0.0015    | +110%             |
| GPT-4.1 mini     | $0.0029  | $0.0058  | $0.0062    | +110%             |
| GPT-4.1          | $0.0147  | $0.0292  | $0.0309    | +110%             |
| Claude Sonnet 4  | $0.0224  | $0.0440  | $0.0465    | +107%             |
| Claude Opus 4    | $0.1122  | $0.2200  | $0.2324    | +107%             |

</details>

### triage (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 16       | 12       | 12         | -25%     |
| Messages received | 16       | 12       | 12         | -25%     |
| Bytes sent        | 1.2 KB   | 1.1 KB   | 1.1 KB     | -7%      |
| Bytes received    | 3.5 KB   | 967 B    | 967 B      | -73%     |
| Total payload     | 4.7 KB   | 2.0 KB   | 2.0 KB     | -57%     |
| Setup time (ms)   | 78.42    | 1.78     | 1.36       | -98%     |
| Total time (ms)   | 15848.14 | 6905.55  | 5908.54    | -63%     |
| Input tokens      | 19058    | 14634    | 10370      | -46%     |
| Output tokens     | 387      | 239      | 239        | -38%     |
| Total tokens      | 19445    | 14873    | 10609      | -45%     |
| Tool calls        | 16       | 12       | 12         | -25%     |
| LLM round trips   | 11       | 2        | 2          | -82%     |
| Est. cost (USD)   | $0.0031  | $0.0023  | $0.0017    | -45%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 15760.81 | 6902.94   | 5906.5          |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0031  | $0.0023  | $0.0017    | -45%              |
| GPT-4.1 nano     | $0.0021  | $0.0016  | $0.0011    | -45%              |
| GPT-4.1 mini     | $0.0082  | $0.0062  | $0.0045    | -45%              |
| GPT-4.1          | $0.0412  | $0.0312  | $0.0227    | -45%              |
| Claude Sonnet 4  | $0.0630  | $0.0475  | $0.0347    | -45%              |
| Claude Opus 4    | $0.3149  | $0.2374  | $0.1735    | -45%              |

</details>

### bulk-update (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 7        | 3        | 6          | -57%     |
| Messages received | 7        | 3        | 6          | -57%     |
| Bytes sent        | 478 B    | 208 B    | 423 B      | -56%     |
| Bytes received    | 1.7 KB   | 213 B    | 1.1 KB     | -88%     |
| Total payload     | 2.2 KB   | 421 B    | 1.5 KB     | -81%     |
| Setup time (ms)   | 68.18    | 2.4      | 1.47       | -98%     |
| Total time (ms)   | 6552.13  | 2797.32  | 7639.82    | -57%     |
| Input tokens      | 9508     | 14203    | 36197      | +49%     |
| Output tokens     | 157      | 39       | 90         | -75%     |
| Total tokens      | 9665     | 14242    | 36287      | +47%     |
| Tool calls        | 7        | 3        | 6          | -57%     |
| LLM round trips   | 8        | 2        | 7          | -75%     |
| Est. cost (USD)   | $0.0015  | $0.0022  | $0.0055    | +42%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 6475.52  | 2794.12   | 7637.55         |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0015  | $0.0022  | $0.0055    | +261%             |
| GPT-4.1 nano     | $0.0010  | $0.0014  | $0.0037    | +261%             |
| GPT-4.1 mini     | $0.0041  | $0.0057  | $0.0146    | +261%             |
| GPT-4.1          | $0.0203  | $0.0287  | $0.0731    | +261%             |
| Claude Sonnet 4  | $0.0309  | $0.0432  | $0.1099    | +256%             |
| Claude Opus 4    | $0.1544  | $0.2160  | $0.5497    | +256%             |

</details>

### scale-triage (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 20       | 34       | 32         | +60%     |
| Messages received | 20       | 34       | 32         | +60%     |
| Bytes sent        | 1.5 KB   | 3.1 KB   | 2.9 KB     | +92%     |
| Bytes received    | 5.8 KB   | 2.7 KB   | 2.5 KB     | -57%     |
| Total payload     | 7.4 KB   | 5.8 KB   | 5.5 KB     | -26%     |
| Setup time (ms)   | 77.54    | 3.74     | 3.56       | -95%     |
| Total time (ms)   | 28594.53 | 17463.16 | 15950.82   | -44%     |
| Input tokens      | 46628    | 102204   | 62554      | +34%     |
| Output tokens     | 544      | 698      | 657        | +21%     |
| Total tokens      | 47172    | 102902   | 63211      | +34%     |
| Tool calls        | 20       | 34       | 32         | +60%     |
| LLM round trips   | 21       | 2        | 2          | -90%     |
| Est. cost (USD)   | $0.0073  | $0.0157  | $0.0098    | +34%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 28508.22 | 17457.55  | 15945.98        |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0073  | $0.0157  | $0.0098    | +34%              |
| GPT-4.1 nano     | $0.0049  | $0.0105  | $0.0065    | +34%              |
| GPT-4.1 mini     | $0.0195  | $0.0420  | $0.0261    | +34%              |
| GPT-4.1          | $0.0976  | $0.2100  | $0.1304    | +34%              |
| Claude Sonnet 4  | $0.1480  | $0.3171  | $0.1975    | +33%              |
| Claude Opus 4    | $0.7402  | $1.5854  | $0.9876    | +33%              |

</details>

MCP vs SLOP Benchmark
=====================
Mode: agent
Model: gemini-2.5-pro
Scenarios: explore-and-act, triage, bulk-update, scale-triage
Iterations: 3

--- Agent Mode ---

  Running agent scenario: explore-and-act
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: triage
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: bulk-update
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: scale-triage (large dataset)
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...
# MCP vs SLOP Benchmark Results

**Date:** 2026-04-01T19:02:13.392Z
**Platform:** darwin arm64
**Mode:** agent
**Iterations:** 3
**Model:** gemini-2.5-pro ($1.25/M input, $10/M output)

### explore-and-act (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 4        | 2        | 2          | -50%     |
| Messages received | 4        | 2        | 2          | -50%     |
| Bytes sent        | 368 B    | 291 B    | 291 B      | -21%     |
| Bytes received    | 1.5 KB   | 350 B    | 350 B      | -77%     |
| Total payload     | 1.9 KB   | 641 B    | 641 B      | -66%     |
| Setup time (ms)   | 58.67    | 2.68     | 1.67       | -97%     |
| Total time (ms)   | 12605.25 | 6643.82  | 6934.37    | -47%     |
| Input tokens      | 4474     | 14359    | 10095      | +126%    |
| Output tokens     | 106      | 62       | 62         | -42%     |
| Total tokens      | 4580     | 14421    | 10157      | +122%    |
| Tool calls        | 4        | 2        | 2          | -50%     |
| LLM round trips   | 4        | 2        | 2          | -50%     |
| Est. cost (USD)   | $0.0016  | $0.0045  | $0.0032    | +98%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 12542.03 | 6639.18   | 6931.63         |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0016  | $0.0045  | $0.0032    | +98%              |
| Gemini 2.5 Pro   | $0.0067  | $0.0186  | $0.0132    | +99%              |
| Gemini 3 Flash   | $0.0026  | $0.0074  | $0.0052    | +105%             |
| Gemini 3.1 Pro   | $0.0102  | $0.0295  | $0.0209    | +105%             |
| GPT-4.1 nano     | $0.490m  | $0.0015  | $0.0010    | +111%             |
| GPT-4.1 mini     | $0.0020  | $0.0058  | $0.0041    | +111%             |
| GPT-4.1          | $0.0098  | $0.0292  | $0.0207    | +111%             |
| Claude Sonnet 4  | $0.0150  | $0.0440  | $0.0312    | +108%             |
| Claude Opus 4    | $0.0751  | $0.2200  | $0.1561    | +108%             |

</details>

### triage (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 16       | 12       | 12         | -25%     |
| Messages received | 16       | 12       | 12         | -25%     |
| Bytes sent        | 1.2 KB   | 1.1 KB   | 1.1 KB     | -7%      |
| Bytes received    | 3.5 KB   | 967 B    | 967 B      | -73%     |
| Total payload     | 4.7 KB   | 2.0 KB   | 2.0 KB     | -57%     |
| Setup time (ms)   | 101.21   | 2.84     | 1.4        | -99%     |
| Total time (ms)   | 26984.82 | 11655.25 | 18883.18   | -57%     |
| Input tokens      | 13245    | 14634    | 10370      | -22%     |
| Output tokens     | 387      | 239      | 239        | -38%     |
| Total tokens      | 13632    | 14873    | 10609      | -22%     |
| Tool calls        | 16       | 12       | 12         | -25%     |
| LLM round trips   | 8        | 2        | 2          | -75%     |
| Est. cost (USD)   | $0.0049  | $0.0050  | $0.0037    | -25%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 26872.61 | 11651.37  | 18881.09        |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0049  | $0.0050  | $0.0037    | -25%              |
| Gemini 2.5 Pro   | $0.0204  | $0.0207  | $0.0154    | -25%              |
| Gemini 3 Flash   | $0.0078  | $0.0080  | $0.0059    | -24%              |
| Gemini 3.1 Pro   | $0.0311  | $0.0321  | $0.0236    | -24%              |
| GPT-4.1 nano     | $0.0015  | $0.0016  | $0.0011    | -23%              |
| GPT-4.1 mini     | $0.0059  | $0.0062  | $0.0045    | -23%              |
| GPT-4.1          | $0.0296  | $0.0312  | $0.0227    | -23%              |
| Claude Sonnet 4  | $0.0455  | $0.0475  | $0.0347    | -24%              |
| Claude Opus 4    | $0.2277  | $0.2374  | $0.1735    | -24%              |

</details>

### bulk-update (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 7        | 3        | 6          | -57%     |
| Messages received | 7        | 3        | 6          | -57%     |
| Bytes sent        | 478 B    | 208 B    | 477 B      | -56%     |
| Bytes received    | 1.7 KB   | 213 B    | 411 B      | -88%     |
| Total payload     | 2.2 KB   | 421 B    | 888 B      | -81%     |
| Setup time (ms)   | 78.95    | 2.92     | 1.9        | -98%     |
| Total time (ms)   | 23053.05 | 9387.98  | 9944.88    | -59%     |
| Input tokens      | 9508     | 14203    | 15085      | +49%     |
| Output tokens     | 157      | 39       | 111        | -75%     |
| Total tokens      | 9665     | 14242    | 15196      | +47%     |
| Tool calls        | 7        | 3        | 6          | -57%     |
| LLM round trips   | 8        | 2        | 3          | -75%     |
| Est. cost (USD)   | $0.0032  | $0.0044  | $0.0048    | +34%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 22964.99 | 9384      | 9942.22         |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0032  | $0.0044  | $0.0048    | +48%              |
| Gemini 2.5 Pro   | $0.0135  | $0.0181  | $0.0200    | +48%              |
| Gemini 3 Flash   | $0.0052  | $0.0072  | $0.0079    | +51%              |
| Gemini 3.1 Pro   | $0.0209  | $0.0289  | $0.0315    | +51%              |
| GPT-4.1 nano     | $0.0010  | $0.0014  | $0.0016    | +53%              |
| GPT-4.1 mini     | $0.0041  | $0.0057  | $0.0062    | +53%              |
| GPT-4.1          | $0.0203  | $0.0287  | $0.0311    | +53%              |
| Claude Sonnet 4  | $0.0309  | $0.0432  | $0.0469    | +52%              |
| Claude Opus 4    | $0.1544  | $0.2160  | $0.2346    | +52%              |

</details>

### scale-triage (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 20       | 34       | 32         | +60%     |
| Messages received | 20       | 34       | 32         | +60%     |
| Bytes sent        | 1.5 KB   | 3.1 KB   | 2.9 KB     | +101%    |
| Bytes received    | 11.8 KB  | 2.7 KB   | 2.5 KB     | -79%     |
| Total payload     | 13.2 KB  | 5.8 KB   | 5.5 KB     | -59%     |
| Setup time (ms)   | 89.95    | 5.49     | 4.43       | -95%     |
| Total time (ms)   | 52882.14 | 13921.3  | 60994.3    | -74%     |
| Input tokens      | 64445    | 102190   | 62554      | -3%      |
| Output tokens     | 519      | 698      | 657        | +27%     |
| Total tokens      | 64964    | 102888   | 63211      | -3%      |
| Tool calls        | 20       | 34       | 32         | +60%     |
| LLM round trips   | 21       | 2        | 2          | -90%     |
| Est. cost (USD)   | $0.0206  | $0.0324  | $0.0204    | -1%      |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 52784.47 | 13913.87  | 60988.46        |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0206  | $0.0324  | $0.0204    | -1%               |
| Gemini 2.5 Pro   | $0.0857  | $0.1347  | $0.0848    | -1%               |
| Gemini 3 Flash   | $0.0338  | $0.0532  | $0.0332    | -2%               |
| Gemini 3.1 Pro   | $0.1351  | $0.2128  | $0.1330    | -2%               |
| GPT-4.1 nano     | $0.0067  | $0.0105  | $0.0065    | -2%               |
| GPT-4.1 mini     | $0.0266  | $0.0420  | $0.0261    | -2%               |
| GPT-4.1          | $0.1330  | $0.2100  | $0.1304    | -2%               |
| Claude Sonnet 4  | $0.2011  | $0.3170  | $0.1975    | -2%               |
| Claude Opus 4    | $1.0056  | $1.5852  | $0.9876    | -2%               |

</details>

MCP vs SLOP Benchmark
=====================
Mode: agent
Model: gemini-3-flash-preview
Scenarios: explore-and-act, triage, bulk-update, scale-triage
Iterations: 3

--- Agent Mode ---

  Running agent scenario: explore-and-act
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: triage
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: bulk-update
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: scale-triage (large dataset)
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...
# MCP vs SLOP Benchmark Results

**Date:** 2026-04-01T19:07:10.135Z
**Platform:** darwin arm64
**Mode:** agent
**Iterations:** 3
**Model:** gemini-3-flash-preview ($0.5/M input, $3/M output)

### explore-and-act (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 4        | 2        | 2          | -50%     |
| Messages received | 4        | 2        | 2          | -50%     |
| Bytes sent        | 368 B    | 291 B    | 291 B      | -21%     |
| Bytes received    | 1.5 KB   | 350 B    | 339 B      | -78%     |
| Total payload     | 1.9 KB   | 641 B    | 630 B      | -67%     |
| Setup time (ms)   | 57.66    | 3.32     | 1.33       | -98%     |
| Total time (ms)   | 6948.07  | 4347.5   | 5928.85    | -37%     |
| Input tokens      | 7464     | 16447    | 12229      | +64%     |
| Output tokens     | 114      | 66       | 65         | -43%     |
| Total tokens      | 7578     | 16513    | 12294      | +62%     |
| Tool calls        | 4        | 2        | 2          | -50%     |
| LLM round trips   | 5        | 2        | 2          | -60%     |
| Est. cost (USD)   | $0.0025  | $0.0051  | $0.0038    | +52%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 6882.94  | 4341.85   | 5926.82         |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0025  | $0.0051  | $0.0038    | +52%              |
| Gemini 2.5 Pro   | $0.0105  | $0.0212  | $0.0159    | +52%              |
| Gemini 3 Flash   | $0.0041  | $0.0084  | $0.0063    | +55%              |
| Gemini 3.1 Pro   | $0.0163  | $0.0337  | $0.0252    | +55%              |
| GPT-4.1 nano     | $0.792m  | $0.0017  | $0.0012    | +58%              |
| GPT-4.1 mini     | $0.0032  | $0.0067  | $0.0050    | +58%              |
| GPT-4.1          | $0.0158  | $0.0334  | $0.0250    | +58%              |
| Claude Sonnet 4  | $0.0241  | $0.0503  | $0.0377    | +56%              |
| Claude Opus 4    | $0.1205  | $0.2517  | $0.1883    | +56%              |

</details>

### triage (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 16       | 12       | 12         | -25%     |
| Messages received | 16       | 12       | 12         | -25%     |
| Bytes sent        | 1.2 KB   | 1.1 KB   | 1.1 KB     | -7%      |
| Bytes received    | 3.5 KB   | 967 B    | 967 B      | -73%     |
| Total payload     | 4.7 KB   | 2.0 KB   | 2.0 KB     | -57%     |
| Setup time (ms)   | 81.67    | 1.73     | 1.69       | -98%     |
| Total time (ms)   | 11358.48 | 7613.82  | 7694.2     | -33%     |
| Input tokens      | 18036    | 17150    | 12915      | -28%     |
| Output tokens     | 417      | 251      | 251        | -40%     |
| Total tokens      | 18453    | 17401    | 13166      | -29%     |
| Tool calls        | 16       | 12       | 12         | -25%     |
| LLM round trips   | 8        | 2        | 2          | -75%     |
| Est. cost (USD)   | $0.0065  | $0.0058  | $0.0045    | -30%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 11269.96 | 7611.29   | 7691.72         |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0065  | $0.0058  | $0.0045    | -30%              |
| Gemini 2.5 Pro   | $0.0267  | $0.0239  | $0.0187    | -30%              |
| Gemini 3 Flash   | $0.0103  | $0.0093  | $0.0072    | -30%              |
| Gemini 3.1 Pro   | $0.0411  | $0.0373  | $0.0288    | -30%              |
| GPT-4.1 nano     | $0.0020  | $0.0018  | $0.0014    | -29%              |
| GPT-4.1 mini     | $0.0079  | $0.0073  | $0.0056    | -29%              |
| GPT-4.1          | $0.0394  | $0.0363  | $0.0278    | -29%              |
| Claude Sonnet 4  | $0.0604  | $0.0552  | $0.0425    | -30%              |
| Claude Opus 4    | $0.3018  | $0.2761  | $0.2125    | -30%              |

</details>

### bulk-update (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 7        | 3        | 3          | -57%     |
| Messages received | 7        | 3        | 3          | -57%     |
| Bytes sent        | 478 B    | 208 B    | 208 B      | -56%     |
| Bytes received    | 1.7 KB   | 213 B    | 213 B      | -88%     |
| Total payload     | 2.2 KB   | 421 B    | 421 B      | -81%     |
| Setup time (ms)   | 80.74    | 1.9      | 1.41       | -98%     |
| Total time (ms)   | 5714.81  | 6201.66  | 5435.27    | -5%      |
| Input tokens      | 5924     | 16546    | 12095      | +104%    |
| Output tokens     | 169      | 39       | 39         | -77%     |
| Total tokens      | 6093     | 16585    | 12134      | +99%     |
| Tool calls        | 7        | 3        | 3          | -57%     |
| LLM round trips   | 4        | 2        | 2          | -50%     |
| Est. cost (USD)   | $0.0022  | $0.0051  | $0.0037    | +69%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 5627.05  | 6199.07   | 5433.04         |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0022  | $0.0051  | $0.0037    | +69%              |
| Gemini 2.5 Pro   | $0.0091  | $0.0211  | $0.0155    | +71%              |
| Gemini 3 Flash   | $0.0035  | $0.0084  | $0.0062    | +78%              |
| Gemini 3.1 Pro   | $0.0139  | $0.0336  | $0.0247    | +78%              |
| GPT-4.1 nano     | $0.660m  | $0.0017  | $0.0012    | +86%              |
| GPT-4.1 mini     | $0.0026  | $0.0067  | $0.0049    | +86%              |
| GPT-4.1          | $0.0132  | $0.0334  | $0.0245    | +86%              |
| Claude Sonnet 4  | $0.0203  | $0.0502  | $0.0369    | +82%              |
| Claude Opus 4    | $0.1015  | $0.2511  | $0.1844    | +82%              |

</details>

### scale-triage (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 43       | 32       | 32         | -26%     |
| Messages received | 43       | 32       | 32         | -26%     |
| Bytes sent        | 3.3 KB   | 2.9 KB   | 2.9 KB     | -12%     |
| Bytes received    | 9.3 KB   | 2.5 KB   | 2.5 KB     | -73%     |
| Total payload     | 12.7 KB  | 5.4 KB   | 5.5 KB     | -57%     |
| Setup time (ms)   | 80.88    | 4.4      | 4.03       | -95%     |
| Total time (ms)   | 13579.03 | 19528.32 | 28961.63   | +44%     |
| Input tokens      | 14012    | 116377   | 76076      | +443%    |
| Output tokens     | 1229     | 687      | 689        | -44%     |
| Total tokens      | 15241    | 117064   | 76765      | +404%    |
| Tool calls        | 43       | 32       | 32         | -26%     |
| LLM round trips   | 4        | 2        | 2          | -50%     |
| Est. cost (USD)   | $0.0073  | $0.0366  | $0.0245    | +237%    |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 13491.73 | 19522.1   | 28956.36        |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0073  | $0.0366  | $0.0245    | +237%             |
| Gemini 2.5 Pro   | $0.0298  | $0.1523  | $0.1020    | +242%             |
| Gemini 3 Flash   | $0.0107  | $0.0602  | $0.0401    | +275%             |
| Gemini 3.1 Pro   | $0.0428  | $0.2410  | $0.1604    | +275%             |
| GPT-4.1 nano     | $0.0019  | $0.0119  | $0.0079    | +316%             |
| GPT-4.1 mini     | $0.0076  | $0.0477  | $0.0315    | +316%             |
| GPT-4.1          | $0.0379  | $0.2382  | $0.1577    | +316%             |
| Claude Sonnet 4  | $0.0605  | $0.3594  | $0.2386    | +295%             |
| Claude Opus 4    | $0.3024  | $1.7972  | $1.1928    | +295%             |

</details>

MCP vs SLOP Benchmark
=====================
Mode: agent
Model: gemini-3.1-pro-preview
Scenarios: explore-and-act, triage, bulk-update, scale-triage
Iterations: 3

--- Agent Mode ---

  Running agent scenario: explore-and-act
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: triage
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: bulk-update
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...

  Running agent scenario: scale-triage (large dataset)
    MCP agent...
    SLOP agent (full tree)...
    SLOP agent (optimized)...
# MCP vs SLOP Benchmark Results

**Date:** 2026-04-01T19:12:57.764Z
**Platform:** darwin arm64
**Mode:** agent
**Iterations:** 3
**Model:** gemini-3.1-pro-preview ($2/M input, $12/M output)

### explore-and-act (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 4        | 2        | 3          | -50%     |
| Messages received | 4        | 2        | 3          | -50%     |
| Bytes sent        | 368 B    | 291 B    | 385 B      | -21%     |
| Bytes received    | 1.5 KB   | 350 B    | 677 B      | -77%     |
| Total payload     | 1.9 KB   | 641 B    | 1.0 KB     | -66%     |
| Setup time (ms)   | 60.84    | 4.99     | 2.42       | -96%     |
| Total time (ms)   | 11493.34 | 6111.54  | 12141.59   | -47%     |
| Input tokens      | 5974     | 16392    | 18701      | +174%    |
| Output tokens     | 114      | 66       | 84         | -42%     |
| Total tokens      | 6088     | 16458    | 18785      | +170%    |
| Tool calls        | 4        | 2        | 3          | -50%     |
| LLM round trips   | 4        | 2        | 3          | -50%     |
| Est. cost (USD)   | $0.0021  | $0.0051  | $0.0058    | +145%    |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 11424.1  | 6103.79   | 12138.18        |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0021  | $0.0051  | $0.0058    | +180%             |
| Gemini 2.5 Pro   | $0.0086  | $0.0212  | $0.0242    | +181%             |
| Gemini 3 Flash   | $0.0033  | $0.0084  | $0.0096    | +188%             |
| Gemini 3.1 Pro   | $0.0133  | $0.0336  | $0.0384    | +188%             |
| GPT-4.1 nano     | $0.643m  | $0.0017  | $0.0019    | +196%             |
| GPT-4.1 mini     | $0.0026  | $0.0067  | $0.0076    | +196%             |
| GPT-4.1          | $0.0129  | $0.0333  | $0.0381    | +196%             |
| Claude Sonnet 4  | $0.0196  | $0.0502  | $0.0574    | +192%             |
| Claude Opus 4    | $0.0982  | $0.2508  | $0.2868    | +192%             |

</details>

### triage (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 16       | 12       | 15         | -25%     |
| Messages received | 16       | 12       | 15         | -25%     |
| Bytes sent        | 1.2 KB   | 1.1 KB   | 1.3 KB     | -7%      |
| Bytes received    | 3.5 KB   | 967 B    | 2.6 KB     | -73%     |
| Total payload     | 4.7 KB   | 2.0 KB   | 3.9 KB     | -57%     |
| Setup time (ms)   | 80.72    | 2.18     | 1.41       | -98%     |
| Total time (ms)   | 18768.73 | 12201.14 | 18948.1    | -35%     |
| Input tokens      | 8854     | 17304    | 20586      | +95%     |
| Output tokens     | 417      | 251      | 299        | -40%     |
| Total tokens      | 9271     | 17555    | 20885      | +89%     |
| Tool calls        | 16       | 12       | 15         | -25%     |
| LLM round trips   | 4        | 2        | 3          | -50%     |
| Est. cost (USD)   | $0.0037  | $0.0058  | $0.0069    | +57%     |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 18680.69 | 12198.03  | 18945.98        |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0037  | $0.0058  | $0.0069    | +87%              |
| Gemini 2.5 Pro   | $0.0152  | $0.0241  | $0.0287    | +88%              |
| Gemini 3 Flash   | $0.0057  | $0.0094  | $0.0112    | +97%              |
| Gemini 3.1 Pro   | $0.0227  | $0.0376  | $0.0448    | +97%              |
| GPT-4.1 nano     | $0.0011  | $0.0018  | $0.0022    | +107%             |
| GPT-4.1 mini     | $0.0042  | $0.0073  | $0.0087    | +107%             |
| GPT-4.1          | $0.0210  | $0.0366  | $0.0436    | +107%             |
| Claude Sonnet 4  | $0.0328  | $0.0557  | $0.0662    | +102%             |
| Claude Opus 4    | $0.1641  | $0.2784  | $0.3312    | +102%             |

</details>

### bulk-update (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 7        | 3        | 6          | -57%     |
| Messages received | 7        | 3        | 6          | -57%     |
| Bytes sent        | 478 B    | 208 B    | 423 B      | -56%     |
| Bytes received    | 1.7 KB   | 213 B    | 1.1 KB     | -88%     |
| Total payload     | 2.2 KB   | 421 B    | 1.5 KB     | -81%     |
| Setup time (ms)   | 78.47    | 2.33     | 1.68       | -98%     |
| Total time (ms)   | 14156.05 | 6854.98  | 11771.86   | -52%     |
| Input tokens      | 5691     | 16304    | 18902      | +186%    |
| Output tokens     | 169      | 39       | 93         | -77%     |
| Total tokens      | 5860     | 16343    | 18995      | +179%    |
| Tool calls        | 7        | 3        | 6          | -57%     |
| LLM round trips   | 4        | 2        | 3          | -50%     |
| Est. cost (USD)   | $0.0021  | $0.0050  | $0.0059    | +134%    |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 14070.58 | 6851.81   | 11769.27        |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0021  | $0.0050  | $0.0059    | +177%             |
| Gemini 2.5 Pro   | $0.0088  | $0.0208  | $0.0246    | +179%             |
| Gemini 3 Flash   | $0.0034  | $0.0083  | $0.0097    | +190%             |
| Gemini 3.1 Pro   | $0.0134  | $0.0331  | $0.0389    | +190%             |
| GPT-4.1 nano     | $0.637m  | $0.0016  | $0.0019    | +203%             |
| GPT-4.1 mini     | $0.0025  | $0.0066  | $0.0077    | +203%             |
| GPT-4.1          | $0.0127  | $0.0329  | $0.0385    | +203%             |
| Claude Sonnet 4  | $0.0196  | $0.0495  | $0.0581    | +196%             |
| Claude Opus 4    | $0.0980  | $0.2475  | $0.2905    | +196%             |

</details>

### scale-triage (agent)

| Metric            | MCP      | SLOP     | SLOP (opt) | vs MCP   |
|-------------------|----------|----------|------------|----------|
| Messages sent     | 43       | 32       | 52         | -26%     |
| Messages received | 43       | 32       | 52         | -26%     |
| Bytes sent        | 3.3 KB   | 2.9 KB   | 4.5 KB     | -12%     |
| Bytes received    | 9.3 KB   | 2.5 KB   | 30.9 KB    | -73%     |
| Total payload     | 12.7 KB  | 5.5 KB   | 35.5 KB    | -57%     |
| Setup time (ms)   | 77.08    | 4.65     | 4.26       | -94%     |
| Total time (ms)   | 32571.82 | 57266    | 34380.43   | +6%      |
| Input tokens      | 21092    | 119139   | 166059     | +465%    |
| Output tokens     | 1229     | 689      | 1101       | -44%     |
| Total tokens      | 22321    | 119828   | 167160     | +437%    |
| Tool calls        | 43       | 32       | 52         | -26%     |
| LLM round trips   | 5        | 2        | 4          | -60%     |
| Est. cost (USD)   | $0.0094  | $0.0375  | $0.0526    | +299%    |

<details><summary>Step breakdown</summary>

| Step       | MCP (ms) | SLOP (ms) | SLOP (opt) (ms) |
|------------|----------|-----------|-----------------|
| agent_loop | 32487.72 | 57259.39  | 34374.66        |

</details>

<details><summary>Projected cost across models (same token counts)</summary>

*Note: actual token counts would vary per model. This projects the measured token counts at different price points.*

| Model            | MCP      | SLOP     | SLOP (opt) | SLOP (opt) vs MCP |
|------------------|----------|----------|------------|-------------------|
| Gemini 2.5 Flash | $0.0094  | $0.0375  | $0.0526    | +459%             |
| Gemini 2.5 Pro   | $0.0387  | $0.1558  | $0.2186    | +465%             |
| Gemini 3 Flash   | $0.0142  | $0.0616  | $0.0863    | +507%             |
| Gemini 3.1 Pro   | $0.0569  | $0.2465  | $0.3453    | +507%             |
| GPT-4.1 nano     | $0.0026  | $0.0122  | $0.0170    | +555%             |
| GPT-4.1 mini     | $0.0104  | $0.0488  | $0.0682    | +555%             |
| GPT-4.1          | $0.0520  | $0.2438  | $0.3409    | +555%             |
| Claude Sonnet 4  | $0.0817  | $0.3678  | $0.5147    | +530%             |
| Claude Opus 4    | $0.4086  | $1.8388  | $2.5735    | +530%             |

</details>
