# Avviare LifeOS sul tuo computer

La cartella di lavoro è /home/lorenzo/Desktop/lifeos.

## Avvio semplice

Apri un terminale in questa cartella ed esegui:

```bash
./Avvia-LifeOS.sh
```

Il comando avvia PostgreSQL locale, applica le migrazioni e apre il server su http://localhost:3000. Lascia aperto il terminale. Ctrl+C arresta i processi senza cancellare i dati.

Il database è in `.local/postgres`. Non cancellare questa cartella. Per un backup a programma chiuso copia `.local` e `.env.local` insieme, custodendoli privatamente. Questo avvio è per uso locale, non è una pubblicazione su Internet.

## Configurazione Google necessaria una sola volta

1. Apri https://console.cloud.google.com/ e crea/seleziona un progetto LifeOS.
2. Google Auth Platform: configura il nome LifeOS e la tua email; scegli pubblico Esterno e aggiungi la tua email tra gli utenti di test.
3. In Clients crea un client OAuth di tipo Applicazione web, chiamato LifeOS locale.
4. Inserisci come origine JavaScript autorizzata `http://localhost:3000`.
5. Inserisci come URI di reindirizzamento autorizzato `http://localhost:3000/api/auth/callback/google`.
6. Scarica il JSON del client e salvalo qui come `google-client.json`. Non condividerlo in chat e non inserirlo in Git.
7. Chiedi all'assistente di importare il file e guidarti nella verifica del tuo account Google, necessaria per configurare email e identificativo dell'unico account autorizzato.

Finché questo passaggio non è concluso, il pulsante Google non permette di entrare. Non esiste un account di prova che aggiri il controllo di accesso.

Le chiavi locali sono generate automaticamente in `.env.local`, leggibile solo dal tuo utente. Non modificarle dopo aver iniziato a usare il database.

Fonte Google: https://developers.google.com/identity/protocols/oauth2/web-server
