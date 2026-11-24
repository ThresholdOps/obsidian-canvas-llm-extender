# Canvas Qwen

Rozwijaj mapy myśli w Obsidianie Desktop za pomocą Qwena. Możesz korzystać z modelu na swoim komputerze albo z serwera HTTPS z API zgodnym z OpenAI. Każda zaakceptowana propozycja staje się osobną kartą w zwykłym pliku `.canvas`.

## Instalacja i aktualizacja

[Pobierz Canvas Qwen 0.6.1 dla Obsidiana Desktop](https://github.com/ThresholdOps/obsidian-canvas-llm-extender/raw/refs/heads/pilot-builds/packages/canvas-qwen-branches-0.6.1.zip)

Przy pierwszej instalacji rozpakuj folder `canvas-qwen-branches` do `.obsidian/plugins/` w sejfie. Przy aktualizacji wyłącz wtyczkę i skopiuj z ZIP-a `main.js`, `manifest.json` i `styles.css` do katalogu, w którym masz już zainstalowaną wersję. Następnie odśwież listę zainstalowanych wtyczek i włącz **Canvas Qwen 0.6.1**. Wtyczka wymaga Obsidiana Desktop 1.11.4 lub nowszego.

Archiwum **Code → Download ZIP** również zawiera gotowe pliki. GitHub umieszcza je w folderze `obsidian-canvas-llm-extender-main`.

## Serwer z kluczem API

1. W **Ustawienia → Canvas Qwen → Połączenie** wybierz **Serwer HTTPS (OpenAI Compatible)**. Przy aktualizacji z 0.5.0 zachowasz wcześniej wpisany adres i nazwę modelu.
2. W polu **Adres API** wpisz adres z instrukcji serwera i naciśnij Tab. Pod polem zobaczysz pełny adres żądania. Przy samej nazwie hosta wtyczka dopisuje `/v1/chat/completions`. Dla adresu z prefiksem, np. `https://qwen.example.org/api/v1`, zachowuje ścieżkę i dopisuje `/chat/completions`. Możesz też wkleić pełny adres tej operacji.
3. Wpisz dokładną **nazwę modelu**. W polu **Klucz API** wybierz istniejący sekret Obsidiana albo utwórz nowy, np. `qwen-api`. W wartości sekretu wklej sam klucz. Wtyczka dodaje prefiks `Bearer` podczas wysyłania żądania.
4. W ustawieniach kliknij **Sprawdź czat**. Wtyczka wyśle do wybranego modelu jedno pytanie „Odpowiedz tylko OK.”, korzystając z aktualnie wybranego sekretu. **CZAT OK · HTTP 200** oznacza, że Obsidian odebrał wiadomość czatu.
5. W przeglądarce plików Obsidiana kliknij folder prawym przyciskiem i wybierz **Nowa tablica**. Kliknij dwukrotnie tło i wpisz temat w karcie tekstowej. Kliknij obramowanie karty prawym przyciskiem i wybierz **Rozwiń gałąź z Qwenem**. Sprawdź model, adres i zaznaczone karty, po czym kliknij **Zaproponuj gałęzie**. Możesz poprawić nazwy i dodać tylko wybrane propozycje. W trybie HTTPS wtyczka przyjmuje też odpowiedź modelu w postaci listy od trzech do pięciu krótkich punktów.

Zmiana adresu docelowego wymaga ponownego wybrania sekretu. W ustawieniach wtyczki są zapisane nazwa sekretu i adres, dla którego go wybrałeś. Wartość klucza obsługuje magazyn sekretów Obsidiana.

## Model na tym komputerze

Wybierz **Na tym komputerze** i wpisz nazwę pobranego modelu. Domyślny adres Ollamy to `http://127.0.0.1:11434/v1`, a typowy adres LM Studio to `http://127.0.0.1:1234/v1`. W tym trybie wtyczka dopuszcza tylko pętlę zwrotną i pomija uwierzytelnianie. Serwer lokalny musi obsługiwać odpowiedzi JSON Schema.

## Połączenie i dane

Każde kliknięcie **Zaproponuj gałęzie** wysyła jedno żądanie Chat Completions do wskazanego serwera. W kontekście znajduje się tekst głównej karty oraz tekst wybranych sąsiadów. Wtyczka odrzuca przekierowania, sprawdza certyfikat HTTPS i pomija treści żądań, odpowiedzi i klucz w logach. Serwer HTTPS może korzystać z podstawowego API Chat Completions bez rozszerzenia JSON Schema. Zamknięcie okna przerywa oczekiwanie na odpowiedź.

Przy HTTP 401 sprawdź klucz, a przy 403 uprawnienia do modelu. Przy HTTP 404 test czatu i generowanie gałęzi rozpoznają m.in. stronę HTML, błąd JSON zgłaszający niedostępny model oraz błąd JSON wskazujący na uprawnienia. Opis pochodzi z wtyczki. Treść komunikatu zwróconego przez serwer pozostaje lokalna i nie trafia do logów ani na ekran.

## Budowanie i testy

Użyj Node.js 22.18 lub nowszego. Uruchom `npm ci`, `npm run lint` i `npm test`. Testy budują również plik `main.js`. Test połączenia HTTPS używa polecenia `openssl`, aby wygenerować tymczasowy certyfikat testowy.

Projekt wywodzi się z [Canvas LLM Extender 0.4](https://github.com/Phasip/obsidian-canvas-llm-extender). Licencja MIT.
