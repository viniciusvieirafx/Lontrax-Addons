# Lontrax Addons

O "CurseForge da galera": um app de Windows que instala e atualiza só os addons da Lontrax.
Repositório privado. Os addons de terceiros que aparecem no catálogo são só para uso da galera.

## Para a galera

1. Aceite os convites dos repositórios no e-mail do GitHub.
2. Abra **Lontrax Addons.exe**, clique em **Entrar com GitHub** e confirme o código no navegador (uma vez só).
3. Clique em **Atualizar tudo**. Pronto. Sempre que avisarem que tem novidade, abra o app e clique de novo.

O app acha a pasta do WoW Forever sozinho (`World of Warcraft\_forever_\Interface\AddOns`).
Se não achar, clique em **Alterar** e escolha a pasta.

## Instalação e atualização do próprio app

- Na primeira vez que alguém abre o `.exe` baixado, o app se instala em
  `%LOCALAPPDATA%\Programs\Lontrax Addons` e cria atalhos na Área de Trabalho e no Menu Iniciar.
- Para publicar uma versão nova do app: aumente `<Version>` em `src/LontraxAddons.csproj`,
  rode `dotnet publish src -c Release -o dist` e crie uma Release `vX.Y.Z` neste repositório com o
  `.exe` anexado (nome terminando em `.exe`). Os apps da galera acham sozinhos: com a janela aberta
  aparece "Atualizar o app"; escondido perto do relógio, atualiza em silêncio.

## Adicionar um addon ao catálogo

Edite `catalogo.json` e acrescente um item em `addons`:

```json
{
  "id": "tomtom",
  "nome": "TomTom",
  "descricao": "Setas de navegação e coordenadas.",
  "repo": "viniciusvieirafx/TomTom-galera",
  "ref": "main",
  "pasta": "TomTom",
  "tags": ["Mapa"]
}
```

- `repo`: o repositório do GitHub com o addon (a pasta do addon na raiz do repositório).
- `pasta`: o nome da pasta dentro de `AddOns`.
- Addon que fica numa subpasta do repositório: use `"subpasta": "caminho/da/pasta"`.
- Addon com várias pastas (ex.: `Addon` e `Addon_Options`):
  `"pastas": [ { "origem": "Addon", "destino": "Addon" }, { "origem": "Addon_Options", "destino": "Addon_Options" } ]`
- `obrigatorio: true` esconde o botão "Remover".
- `mensagem` no topo do arquivo aparece como faixa no app (avisos para a galera).

Faça commit e push: na próxima vez que alguém abrir o app (ou clicar em Verificar), o addon aparece.
Lembre de convidar a galera para o repositório novo, e de instalar o GitHub App nele (veja abaixo).

## Para quem mantém o app

- Código em `src/` (.NET 8 WinForms + WebView2; a tela fica em `src/ui/`).
- Gerar o `.exe` (um arquivo só, roda em qualquer Windows 10/11):
  `dotnet publish src -c Release -o dist`
- Login: GitHub App "Lontrax Addons" (Device Flow, permissão só de leitura de conteúdo).
  O Client ID vai em `src/Config.cs`.
- Cada addon instalado ganha um `.lontrax.json` com a versão (commit). A versão anterior de cada
  pasta fica guardada em `%LOCALAPPDATA%\LontraxAddons\backups` (as 2 últimas).
