# Canvas Qwen

Polska wtyczka do Obsidiana Desktop. Zaznacz kartę tekstową na zwykłej mapie Canvas i poproś lokalny model o propozycje gałęzi. Każda zaakceptowana propozycja staje się osobną kartą w pliku `.canvas`.

## Pierwsza mapa

1. Pobierz [paczkę pilota 0.5.0](https://github.com/ThresholdOps/obsidian-canvas-llm-extender/raw/refs/heads/pilot-builds/packages/canvas-qwen-branches-0.5.0.zip) i rozpakuj folder `canvas-qwen-branches` do `.obsidian/plugins/` w sejfie testowym. Włącz **Canvas Qwen** w ustawieniach wtyczek społecznościowych.
2. W ustawieniach **Canvas Qwen** wpisz dokładny identyfikator pobranego modelu. Możesz go odczytać poleceniem `ollama list` lub skopiować z lokalnego serwera w LM Studio. Domyślny adres Ollamy to `http://127.0.0.1:11434/v1`. Dla LM Studio typowy adres to `http://127.0.0.1:1234/v1`.
3. Utwórz zwykłą mapę Canvas z jedną kartą tekstową. Kliknij kartę prawym przyciskiem i wybierz **Rozwiń gałąź z Qwenem**. Obejrzyj treść i zaznacz ewentualne sąsiednie karty tekstowe.
4. Kliknij **Zaproponuj gałęzie**. Zaznacz propozycje, które chcesz wykorzystać, popraw ich nazwy i kliknij **Dodaj wybrane**. Możesz rozwinąć każdą nową kartę.

## Połączenie i dane

Serwer i model działają na tym samym komputerze co Obsidian. Wtyczka wykonuje jedno żądanie do `/v1/chat/completions` po kliknięciu przycisku. Adres ogranicza do interfejsu pętli zwrotnej. Odrzuca przekierowania. Serwer musi obsługiwać odpowiedzi JSON Schema. Użyj modelu załadowanego z dysku. Konfiguracja samego serwera decyduje o tym, gdzie wykonuje on obliczenia.

Treść głównej karty i zaznaczonych sąsiadów trafia do żądania. Zamknięcie okna przerywa oczekiwanie. Akceptacja zapisuje w Canvas tytuły gałęzi i łączące je strzałki. Mapę można dalej edytować po wyłączeniu dodatku.

## Budowanie i testy

Użyj Node.js 22.18 lub nowszego. Uruchom `npm ci`, `npm run lint` i `npm test`. Testy budują również plik `main.js`. Do instalacji ręcznej skopiuj `main.js`, `manifest.json` i `styles.css` do folderu wtyczki wymienionego wyżej.

Projekt wywodzi się z [Canvas LLM Extender 0.4](https://github.com/Phasip/obsidian-canvas-llm-extender). Licencja MIT.
