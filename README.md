# LocalSync · HTML-Prototyp v7

Dark-Mode-App für Browser-Storage, Dateianhänge, Text-Zwischenablage und Pull-Transfers zwischen zwei Geräten. Vanilla HTML, CSS und **klassische JavaScript-Dateien mit `<script>`**; keine ES-Module, kein Bundler, kein `npm install`.

## Neu in v3

- Im Arbeitsbereich **Storage** ist das gesamte Seiten-Heading entfernt (inklusive **Demo-Daten anlegen**). Die Kennzahlen und die gemeinsame Tabelle bleiben erhalten. Die Funktion `seedDemo()` wurde auch aus `js/storage.js` entfernt.
- Die Tabelle besitzt die neue Spalte **Letzte Aktion**: letzte ausgeführte Aktion, Datum/Uhrzeit und **×N** als Nutzungszahl **für genau die Kombination Typ / Schlüssel / Aktion**. Per Hover auf die Zelle zeigt ein Tooltip alle bisher protokollierten Aktionen dieses Typs/Schlüssels.
- **Alle sechs Spaltenüberschriften sind anklickbar**: 1. Klick = aufsteigend (↑), 2. Klick = absteigend (↓), 3. Klick = Standardsortierung (↕); ein Klick auf eine andere Spalte beginnt dort wieder aufsteigend. Sortierung bleibt bei Filterung und Aktualisierung aktiv. Bei Größen-/Zeitwerten stehen nicht verfügbare Angaben am Ende. In „Aktion“ erfolgt die Sortierung nach **Anzahl derzeit verfügbarer Dropdown-Aktionen**.
- Für **localStorage** und **IndexedDB** gibt es jetzt die zusätzliche Aktion **Entfernen (dieses Gerät)** mit Bestätigung. Das Löschen einer IndexedDB betrifft die gesamte **lokale Datenbank**, nicht nur einen Object Store. Ein anderer geöffneter Browser-Tab kann das Löschen blockieren.
- **Dateitransfer** hat eine **eigene Dropdown-Liste** mit genau **Entfernen (dieses Gerät)** und **Download (von Gegenstelle)**. Der Remote-Download speichert die Datei über die Browser-Downloadfunktion; er fügt sie **nicht** automatisch den lokalen Anhängen hinzu. Die Download-Aktion ist ohne verbundene Gegenstelle und verfügbares Gegenstück deaktiviert.
- Der Verlauf zählt abgeschlossene Aktionen; **abgebrochene Bestätigungen/Dateiauswahlen und fehlgeschlagene Transfers werden nicht gezählt**. Datei hinzufügen/entfernen im Bereich Transfer wird ebenfalls protokolliert.

## Tabellenaktionen in v3

| Typ | Dropdown-Aktionen | Verhalten |
| --- | --- | --- |
| **localStorage** | Download (dieses Gerät), Import (von Gegenstelle), Upload (dieses Gerät), **Entfernen (dieses Gerät)** | JSON eines Schlüssels herunterladen, freigegebenen Peer-Schlüssel lokal übernehmen, lokale Datei als Schlüsselwert verwenden oder lokalen Schlüssel nach Rückfrage löschen |
| **IndexedDB** | Download (dieses Gerät), Import (von Gegenstelle), Upload (dieses Gerät), **Entfernen (dieses Gerät)** | JSON einer Datenbank herunterladen, freigegebene Peer-Datenbank per Merge/Replace lokal übernehmen, lokales JSON-Backup laden oder komplette lokale Datenbank nach Rückfrage löschen |
| **Dateitransfer** | **Entfernen (dieses Gerät)**, **Download (von Gegenstelle)** | Lokalen Dateianhang nach Rückfrage aus der Sitzung entfernen oder freigegebene Datei der Gegenstelle als Browser-Download speichern |

Deaktivierte Optionen bleiben sichtbar, wenn der entsprechende Eintrag nicht verfügbar ist. Die Download-Buttons für **lokale Anhänge** im Bereich **Transfer** bleiben bestehen.

### Aktionshistorie

Die Zähler werden unter dem localStorage-Schlüssel **`localsync:v3:action-history`** des aktuellen Origins abgelegt. Damit bleiben sie bei einem Reload oder Neustart des Browsers erhalten. Der Schlüssel erscheint wie jeder andere localStorage-Schlüssel in der Storage-Tabelle und kann dort über **Entfernen (dieses Gerät)** gelöscht werden – dadurch werden die Historie und alle Zähler zurückgesetzt. Der Verlauf wird bei localStorage-Backups/Peer-Freigaben wie sonstiger Origin-Storage behandelt; er enthält **Typen, Schlüsselnamen, Aktionsnamen, Zeitstempel und Zähler**, jedoch nicht die Nutzdaten der Einträge. Speicher- oder Browserbeschränkungen können das dauerhafte Protokollieren verhindern; in diesem Fall läuft die aktuelle Sitzung mit einem In-Memory-Verlauf weiter.

**Was zählt?** Der Zähler wird erst nach erfolgreichem lokalem Löschen/Import/Upload, Start des lokalen Downloads oder Abschluss des Peer-Downloads erhöht. Header-JSON-Importe zählen als Upload für jeden im Backup enthaltenen Schlüssel bzw. jede Datenbank. Dateien hinzufügen wird als eigene Aktion „Datei hinzugefügt“ protokolliert. Wenn ein Schlüssel gelöscht wird und weder lokal noch remote existiert, verschwindet seine Zeile aus der Tabelle, der Verlauf bleibt jedoch erhalten und wird bei erneuter Anlage wieder angezeigt.

## Installation als Delta (v3-Archiv)

Das v3-ZIP enthält **ausschließlich die fünf gegenüber v2 geänderten Dateien**. Zuerst `LocalBridge-HTML-Prototyp.zip` (v1), danach `LocalSync-Delta-v2.zip` in denselben Ordner entpacken. Anschließend **`LocalSync-Delta-v3.zip` darüber entpacken und geänderte Dateien überschreiben**. Ordnerpfad im Archiv: `device-bridge-prototyp/` (bleibt aus Kompatibilitätsgründen so); der sichtbare App-Name ist **LocalSync**.

Die unveränderten `js/files.js`, `js/peer.js`, `js/qr.js`, `server.js` und `LICENSE-QR.txt` stammen aus v2/v1. Die Datei `js/storage.js` aus v3 muss mit ersetzt werden, damit das lokale Löschen von IndexedDB funktioniert.

## Starten

Node.js 18+ erforderlich. Im Projektordner:

```bash
node server.js
```

Lokal `http://localhost:8787` öffnen. Für die Geräteverbindung muss **beide Geräte dieselbe erreichbare Serverinstanz** verwenden; für das zweite Gerät die LAN-Adresse bzw. Domain des Servers angeben. Über **Nicht verbunden** in der Topbar wird der Pairing-Dialog mit QR-Code/Link geöffnet. Freigaben für localStorage, IndexedDB und Clipboard sind standardmäßig deaktiviert; angehängte Dateien werden automatisch freigegeben.

Auf anderen Geräten ist für Clipboard-Zugriff in der Regel **HTTPS** erforderlich. Der bestehende Server unterstützt optional TLS:

```bash
TLS_CERT=/pfad/zum/zertifikat.pem TLS_KEY=/pfad/zum/key.pem PORT=8787 node server.js
```

## Architektur und Grenzen

- **Pull-only:** Die Gegenstelle kann ausschließlich freigegebene Daten herunterladen. Lokale Löschungen, Importe und Uploads ändern nur **dieses Gerät**. WebRTC verschlüsselt den Datentransport.
- **Origin-Isolation:** localStorage und IndexedDB sind nur für den aktuellen Origin sichtbar. `localhost` und eine LAN-IP verwenden verschiedene Origins und damit **unterschiedliche** Browser-Speicherbereiche.
- **Dateien:** Anhänge liegen nur während der laufenden Seite im Speicher. Ein Remote-Dateidownload startet das Speichern im Browser und hängt die Datei **nicht** lokal an. V2-Dateianhänge aus anderen lokalen Aktionen werden nicht rückwirkend angepasst.
- **Größen/Zeitwerte:** Größen sind Schätzungen; localStorage und IndexedDB liefern keine allgemeinen letzten Änderungszeitpunkte. Dateidaten nutzen `File.lastModified`. **Letzte Aktion** ist dagegen der von LocalSync erfasste Ausführungszeitpunkt.
- **Kompatibilität:** Das JSON-Format `localbridge/v1` und die internen `window.LocalBridge*`-APIs bleiben erhalten. Die v3-Aktionshistorie wird nur im lokalen Origin gespeichert und ist kein eigener WebRTC-Schreibbefehl.
- **Sicherheit:** Entwicklungs-/LAN-Prototyp, nicht für das öffentliche Internet gehärtet. Dem Signaling fehlen Authentifizierung, Rate-Limits und Pairing-Bestätigung; für bestimmte Netzwerke wird ein TURN-Server benötigt. Transfers sind auf 100 MB begrenzt.

## Neu in v4 · Inhaltsdialog

- Ein Klick auf den **Schlüssel** in der gemeinsamen Storage-Tabelle öffnet einen modalen, schreibgeschützten **Inhaltsdialog** statt einer separaten Detailkarte unter der Tabelle.
- Der Dialog schließt über **Escape**, das **X**, die Schaltfläche **Schließen**, einen Klick auf den Hintergrund oder **Browser-Zurück** (auch die Zurück-Geste auf Mobilgeräten). Zum Öffnen wird ein History-Eintrag unter **derselben URL** angelegt. Ein explizites Schließen entfernt diesen Eintrag über `history.back()`, damit die nächste Zurück-Aktion regulär funktioniert. Auf `file://` oder in besonders eingeschränkten Umgebungen kann die History-API nicht verfügbar sein; für den zuverlässigen Betrieb den lokalen Server verwenden.
- **localStorage:** Textwert oder formatiertes JSON, ohne den gespeicherten Inhalt zu ändern. **IndexedDB:** JSON-Vorschau der ausgewählten Datenbank inklusive Object Stores und Records. **Dateitransfer:** Text-/Bild-/Audio-/Video-/PDF-Vorschau (soweit Browser und MIME-Typ dies unterstützen). Nicht unterstützte Binärformate zeigen einen Hinweis.
- **Lokale und Remote-Inhalte:** Für lokal vorhandene Schlüssel wird die lokale Variante angezeigt. Bei einem ausschließlich auf der Gegenstelle vorhandenen Eintrag wird bei bestehender Verbindung und Freigabe eine **schreibgeschützte Remote-Vorschau** abgerufen. Sind beide Seiten vorhanden, ist im Dialog zwischen „Dieses Gerät“ und „Gegenstelle“ umschaltbar. Remote-Dateivorschauen laden die Daten nur in den temporären Arbeitsspeicher; es wird **kein Download ausgelöst** und nichts im localStorage oder in der IndexedDB geschrieben.
- Große Text-/JSON-Inhalte werden in der Dialogansicht zur Performance nach **350.000 Zeichen** gekürzt (die normalen Exportaktionen bleiben vollständig). Textdateivorschauen lesen maximal die ersten **2 MB**. Bei Remote-Vorschauen lädt der vorhandene WebRTC-Protokollstand zunächst die betreffende Ressource (localStorage / IndexedDB als Ganzes); es gilt weiterhin die bestehende **100-MB-Transfergrenze**.
- Die bestehenden Freigaben, Dropdown-Aktionen und ihre Nutzungszähler bleiben unverändert; das reine Ansehen eines Inhalts wird **nicht als Transfer-/Bearbeitungsaktion** gezählt.

### Installation als Delta v4

Dieses v4-ZIP wird **über eine vollständige v3-Installation** entpackt und enthält nur die geänderten Dateien: `index.html`, `css/style.css`, `js/app.js`, `js/peer.js` und `README.md`. Die `device-bridge-prototyp/`-Verzeichnisstruktur bleibt mit den vorherigen Deltas kompatibel. Es werden weiterhin **klassische Scripts ohne ES-Module** verwendet.

## Neu in v5 · Ein Workspace, Dropzone, Bildschirm-Wachhaltung

- Die **Sidebar** mit Workspace-Navigation sowie die separate Seite **Transfer** entfallen. Das **LocalSync-Brand** sitzt links in der Topbar statt des Breadcrumbs. Die gemeinsame Storage-Tabelle bleibt Hauptansicht. Die **Zwischenablage** befindet sich jetzt als kompakte Karte unter der Tabelle; Datei-Uploads laufen weiterhin über **+ Dateien**, Copy/Paste und Drag & Drop.
- Bei einem OS-Dateidrag erscheint eine **große Dropzone über der Storage-Ansicht**. Nach Drop, Abbruch oder Verlassen der Seite verschwindet sie. Die abgelegten Dateien erscheinen direkt als **Dateitransfer** in der Tabelle und sind automatisch für die Gegenstelle abrufbar. Ein normaler Textdrag öffnet die Dropzone nicht.
- Solange der WebRTC-Datenkanal verbunden ist, wird nach Möglichkeit die **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`) genutzt, um den Bildschirm aktiv zu halten. Der Status wird rechts in der Topbar angezeigt. Beim Trennen wird der Lock freigegeben; wenn die Seite nach einem Wechsel in den Hintergrund wieder sichtbar wird, wird er erneut angefordert. **Wichtig:** Nur in unterstützten Browsern und sicheren Kontexten (HTTPS oder localhost) verfügbar. Mobilgeräte dürfen einen Lock durch Akku-/Energiesparregeln oder beim Wechsel in den Hintergrund entziehen. Keine Garantie für eine dauerhaft aktive WebRTC-Verbindung bei gesperrtem Gerät.
- Weiterhin klassische `<script>`-Dateien, keine ES-Module. `server.js`, `js/qr.js`, `js/files.js`, `js/peer.js` und `js/storage.js` bleiben gegenüber v4 unverändert.

### Installation als Delta v5

Dieses ZIP über **v4** entpacken. Geändert sind ausschließlich `index.html`, `css/style.css`, `js/app.js` und `README.md`. Der Ordnername `device-bridge-prototyp/` bleibt kompatibel.


## Neu in v6 · Zwischenablage-Dialog und PWA

- Die bisherige Zwischenablage-Karte unterhalb der Storage-Tabelle ist entfernt. In der Topbar öffnet das **Clipboard-Symbol** einen nativen Dialog mit denselben Funktionen: **Inhalt lesen**, **Von Gegenstelle abrufen**, **Text kopieren** und **Leeren**. Der Dialog schließt per **Escape**, Browser-Zurück, X, Klick auf den Hintergrund oder „Schließen“. Der History-Eintrag verwendet dieselbe URL. Der erfasste Zwischenablage-Snapshot und die bereits bestehenden Freigaben bleiben bei Öffnen/Schließen unverändert.
- LocalSync ist eine **installierbare Progressive Web App (PWA)**. Neu sind `manifest.webmanifest`, App-Icons (`assets/`) und `sw.js`. Die PWA nutzt `display: standalone` und ein Startsymbol. Der Service Worker speichert nur die **statischen App-Dateien** für die Offline-Oberfläche; **keine Nutzdaten, Clipboards, Storage-Snapshots, Transfers, Signaling-Nachrichten oder QR-Einladungsparameter** werden durch den Service Worker gecacht.
- **Offline:** Nach der ersten erfolgreichen Online-Ausführung ist die Oberfläche für lokal gespeicherte Daten offline nutzbar (Browser-Unterstützung vorausgesetzt). Gerät-zu-Gerät-Transfers und Pairing benötigen weiter eine erreichbare Signaling-Instanz und WebRTC-Verbindung. Dateien im Transfer Manager sind weiterhin nur in der aktuellen Sitzung vorhanden und überleben keinen App-Neustart.
- **Installation:** LocalSync über `http://localhost:8787` oder vertrauenswürdiges **HTTPS** öffnen. Im Browsermenü „App installieren“ / „Zum Startbildschirm hinzufügen“ wählen. Die Installation benötigt einen sicheren Kontext; `http://192.168.x.x:8787` auf einem zweiten Gerät ist in der Regel **kein** sicherer Kontext und unterstützt daher Service Worker, PWA-Installation, Clipboard und Wake Lock meist nicht. Für echte Geräte Tests HTTPS mit einem vertrauenswürdigen Zertifikat/Reverse Proxy bereitstellen.
- **Updates:** Der Service Worker nutzt einen versionierten Cache `localsync-shell-v6`; eine neue Version sollte den Cache-Namen ändern. Beim Wechsel von der Browser- zur installierten App bleibt die Origin-Isolation bestehen. `localhost`/LAN-IP/Domain sind unterschiedliche Origins mit getrennten Storage-Daten.
- **Wichtig:** Die PWA ist keine Hintergrund-App; das Betriebssystem kann den Bildschirm sperren oder WebRTC pausieren. Wake Lock wirkt nur, solange Seite sichtbar und Browser/OS es unterstützen. Das Signaling ist ein **ungeschützter LAN-Prototyp** und sollte nicht öffentlich exponiert werden.

### Installation als Delta v6

Dieses ZIP über die **vollständige v5-Installation** entpacken. Enthalten sind die geänderten Dateien `index.html`, `css/style.css`, `js/app.js`, `server.js`, `README.md` sowie die neuen Dateien `manifest.webmanifest`, `sw.js` und vier PNG-Icons. Keine ES-Module oder externen JavaScript-Bibliotheken erforderlich.


## Neu in v7 · Sitzung erstellen / Verbindung beitreten

Der Dialog **Verbindung herstellen** ist in zwei eigenständige Bereiche aufgeteilt:

- **Sitzung erstellen:** Mit **„Neue Sitzung erstellen“** wird eine kryptografisch zufällige Session-ID erzeugt und die SSE-/WebRTC-Signalisierung gestartet. Die ID ist kopierbar, dazu gibt es einen QR-Code und einen Einladungslink samt Kopierbutton. Die Server-Adresse kann für ein anderes Gerät auf eine erreichbare IP oder HTTPS-Domain geändert werden. Ein erneuter Klick erstellt eine neue Sitzung und beendet die vorherige.
- **Verbindung beitreten:** Eine Session-ID (12–80 Buchstaben/Zahlen/`_`/`-`) oder ein Einladungslink (`http(s)://server/?room=…`) kann eingegeben und mit **„Verbinden“** verwendet werden. Bei einer ID ist die aktuelle Server-Adresse maßgeblich; bei einem Link zu einem anderen Origin navigiert die App auf die Server-Adresse aus dem Link, damit der Signaling-Endpunkt übereinstimmt. Bei gleicher Server-Adresse wird die Sitzung direkt betreten. Ein Aufruf des Einladungslinks tritt der Sitzung weiterhin automatisch bei.
- Ohne gültigen Einladungslink wird beim Seitenstart **keine Sitzung automatisch erzeugt**. „Verbindung trennen“ verlässt die Sitzung. Der Topbar-Status und die Pull-only-Berechtigungen bleiben erhalten.
- Die PWA-Version erhöht den Service-Worker-Cache auf `localsync-shell-v7`, damit das neue HTML und JavaScript sauber eingespielt werden. Ein vollständiger WebRTC-Test zwischen zwei echten Geräten wird weiterhin empfohlen.

### Installation als Delta v7

`LocalSync-Delta-v7.zip` auf eine vollständige **v6-Installation** entpacken und die geänderten Dateien überschreiben (`index.html`, `css/style.css`, `js/app.js`, `sw.js` und `README.md`). Die übrigen Dateien bleiben unverändert. Keine ES-Module und keine zusätzlichen Abhängigkeiten.
