# Jurnal Barber

Aplicație personală pentru iPhone (PWA): înregistrezi tunsuri, tips-uri și vezi automat cât ai tu și cât are șeful.
Datele stau doar pe telefonul tău (IndexedDB). Nu există cont, server sau abonament.

## Fișiere (toate în același folder, `jurnal-barber/`)

| Fișier | Rol |
|---|---|
| `index.html` | structura aplicației |
| `style.css` | aspectul (inclusiv tema luminoasă/întunecată) |
| `app.js` | toată logica: servicii, tunsuri, calcul, calendar, backup |
| `manifest.json` | spune iPhone-ului că este o aplicație |
| `sw.js` | face aplicația să meargă și fără internet |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | iconițe |

## Cum o pui online (gratuit) ca să o poți instala

Aplicația trebuie găzduită la o adresă `https://…` — altfel iPhone-ul nu o lasă să funcționeze offline.
Nu deschide `index.html` direct din Fișiere pe telefon; nu va merge.

### Varianta simplă: Netlify Drop
1. Pe calculator, intră pe https://app.netlify.com/drop
2. Trage folderul `jurnal-barber` în pagină.
3. Primești o adresă `https://ceva.netlify.app`. Dacă ți se cere, creează un cont gratuit ca site-ul să rămână online.

### Alternativă: GitHub Pages
1. Creezi un repository nou pe github.com și încarci toate fișierele din folder.
2. Settings → Pages → Branch: `main` / root → Save.
3. Adresa apare după un minut: `https://utilizator.github.io/nume-repository/`.

## Instalare pe iPhone
1. Deschide adresa în **Safari** (nu în Chrome).
2. Apasă butonul **Partajare** (pătrat cu săgeată în sus).
3. Alege **Adaugă la ecranul principal** → **Adaugă**.
4. Deschide aplicația de pe Home Screen. Prima dată trebuie să ai internet; după aceea merge și offline.

> Important: aplicația instalată pe Home Screen are propria ei memorie, separată de Safari.
> Instaleaz-o **înainte** să introduci date reale.

## Backup (foarte important)
Profil → **Exportă datele** salvează un fișier `.json` (alege „Salvează în Fișiere”).
Profil → **Importă date** îl restaurează (după confirmare). Fă un backup din când în când.
Dacă schimbi adresa site-ului, datele nu se mută singure — folosește Export/Import.

## Cum funcționează calculul
Se face separat pentru fiecare tuns, cu regula din Profil:
- preț ≤ prag → tu păstrezi suma setată (implicit 100 lei, sau tot prețul dacă e mai mic), restul la șef;
- preț > prag → procentul setat (implicit 50%) la tine;
- tips-ul: procentul setat (implicit 100%) la tine.

Fiecare tuns își salvează propriul nume, preț, tips, dată, oră și împărțirea de atunci.
Dacă schimbi prețul unui serviciu sau regula, tunsurile vechi rămân neschimbate.

## Actualizări
Dacă modifici fișierele și le încarci din nou, schimbă în `sw.js` linia `const CACHE = 'jurnal-barber-v1'`
(în `v2`, `v3` …). Apoi deschide aplicația de două ori ca să se încarce versiunea nouă.

## Notă tehnică: bug-ul cu `hidden`
Ferestrele (sheet-urile) sunt ascunse cu atributul HTML `hidden`. Dacă în CSS un element are `display: flex`,
acesta ignoră `hidden` și fereastra rămâne vizibilă. Soluția e prima regulă din `style.css`:
`[hidden] { display: none !important; }`. Nu o șterge.
