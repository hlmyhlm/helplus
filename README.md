# Help+

Support desk for teams that get most of their issues through WhatsApp.

Help+ pulls issues in from WhatsApp groups, staff chats, a web form and old
systems, turns them into tickets, and suggests answers based on how similar
tickets were solved before. Staff stay in control: the AI suggests, people send.

## Status

Early development. Not ready for production yet.

## Running locally

Needs Node 20+ and PostgreSQL 16+.

```bash
npm install
cp .env.example .env        # then set DATABASE_URL and JWT_SECRET
npx prisma db push
npx tsx --env-file=.env prisma/seed.ts
npm run dev
```

Open http://localhost:3000 and log in with `admin` / `admin123`.
Change that password before anyone else can reach the app.

## Docker

```bash
docker compose up -d
```

## Tests

```bash
npm test
npx tsc --noEmit
```

## Docs

More detail in [`docs/wiki`](docs/wiki/Home.md).

## License

MIT. See [LICENSE](LICENSE).
