## luowen-dark（canvas #141414 / card #353535）

| token | hex | L | C | H | 画布对比度 | 卡片对比度 | 门槛 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| link.image | #76BCFF | 0.775 | 0.12 | 248.8 | 9.13:1 | 6.08:1 | PASS |
| link.video | #5196D6 | 0.655 | 0.12 | 248.8 | 5.86:1 | 3.9:1 | PASS |
| link.latent | #DF9ADE | 0.775 | 0.12 | 327.1 | 8.61:1 | 5.73:1 | PASS |
| link.conditioning | #D09244 | 0.705 | 0.12 | 69.8 | 6.91:1 | 4.6:1 | PASS |
| link.clip | #C1BA59 | 0.775 | 0.12 | 105.3 | 9.15:1 | 6.1:1 | PASS |
| link.vae | #F99692 | 0.775 | 0.12 | 22.9 | 8.6:1 | 5.73:1 | PASS |
| link.model | #A192E5 | 0.705 | 0.12 | 291.4 | 6.81:1 | 4.53:1 | PASS |
| link.mask | #6EB470 | 0.705 | 0.12 | 144.8 | 7.39:1 | 4.92:1 | PASS |
| link.audio | #44CFBD | 0.775 | 0.12 | 182.9 | 9.57:1 | 6.37:1 | PASS |
| link.mesh3d | #13B3CA | 0.705 | 0.12 | 211.2 | 7.31:1 | 4.86:1 | PASS |
| link.scalar | #89939E | 0.66 | 0.02 | 250 | 5.9:1 | 3.93:1 | PASS |
| link.struct | #77818C | 0.6 | 0.02 | 250 | 4.65:1 | 3.1:1 | PASS |
| link.unknown | #9BA6B1 | 0.72 | 0.02 | 250 | 7.44:1 | 4.95:1 | PASS |

- 色盲全矩阵最差：link.video / link.model @ ΔE 0.0257（门槛 0.02）
- 相邻色相最差：audio(182.9) / mesh3d(211.2) @ ΔE 0.0585
- 连线覆盖：4388 条，显式 4388、规则 0、回落 0

## luowen-cyberpunk（canvas #0A0A1A / card #1A1A3A）

| token | hex | L | C | H | 画布对比度 | 卡片对比度 | 门槛 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| link.image | #7EBDFB | 0.78 | 0.11 | 248.8 | 9.86:1 | 8.43:1 | PASS |
| link.video | #5A98D3 | 0.662 | 0.11 | 248.8 | 6.41:1 | 5.48:1 | PASS |
| link.latent | #DD9EDC | 0.78 | 0.11 | 327.1 | 9.33:1 | 7.98:1 | PASS |
| link.conditioning | #CE9550 | 0.712 | 0.11 | 69.8 | 7.5:1 | 6.42:1 | PASS |
| link.clip | #C1BC64 | 0.78 | 0.11 | 105.3 | 9.94:1 | 8.5:1 | PASS |
| link.vae | #F69B96 | 0.78 | 0.11 | 22.9 | 9.38:1 | 8.02:1 | PASS |
| link.model | #A395E1 | 0.712 | 0.11 | 291.4 | 7.42:1 | 6.34:1 | PASS |
| link.mask | #75B476 | 0.712 | 0.11 | 144.8 | 7.98:1 | 6.82:1 | PASS |
| link.audio | #57CEBE | 0.78 | 0.11 | 182.9 | 10.25:1 | 8.76:1 | PASS |
| link.mesh3d | #36B4C9 | 0.712 | 0.11 | 211.2 | 7.96:1 | 6.81:1 | PASS |
| link.scalar | #89939E | 0.66 | 0.02 | 250 | 6.28:1 | 5.37:1 | PASS |
| link.struct | #77818C | 0.6 | 0.02 | 250 | 4.95:1 | 4.23:1 | PASS |
| link.unknown | #9BA6B1 | 0.72 | 0.02 | 250 | 7.92:1 | 6.77:1 | PASS |

- 色盲全矩阵最差：link.video / link.model @ ΔE 0.0236（门槛 0.02）
- 相邻色相最差：audio(182.9) / mesh3d(211.2) @ ΔE 0.0539
- 连线覆盖：4388 条，显式 4388、规则 0、回落 0

## 输出类型外推（object_info 208 类）

- 回落 link.unknown：9 类 / 212 槽
- *(203)、NLFPRED(2)、FACE_LANDMARKS(1)、simple,sgm_uniform,karras,exponential,ddim_uniform,beta,normal,linear_quadratic,kl_optimal,AYS SDXL,AYS SD1,AYS SVD,GITS[coeff=1.2],LTXV[default],OSS FLUX,OSS Wan,OSS Chroma(1)、default,comfy,comfy_chunked(1)、unipc,unipc/beta,dpm++,dpm++/beta,dpm++_sde,dpm++_sde/beta,euler,euler/beta,longcat_distill_euler,deis,lcm,lcm/beta,res_multistep,er_sde,flowmatch_causvid,flowmatch_distill,flowmatch_pusa,multitalk,sa_ode_stable,rcm,vibt_unipc(1)、UNIANIMATE_POSE(1)、MTVCRAFTERMOTION(1)、LYNXIP(1)
