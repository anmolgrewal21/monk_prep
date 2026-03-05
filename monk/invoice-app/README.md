This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


invoice-app/
├── data/
│   └── db.json              ← The "database" (all stored data lives here)
│
├── src/
│   ├── lib/
│   │   ├── types.ts          ← Schema definitions (TypeScript interfaces)
│   │   └── db.ts             ← DB utility (read/write JSON file + ID generator)
│   │
│   └── app/
│       ├── layout.tsx        ← App shell (header, wrapper)
│       ├── page.tsx          ← UI — invoice list table with actions
│       │
│       └── api/
│           ├── customers/
│           │   └── route.ts  ← GET /api/customers
│           │
│           └── invoices/
│               ├── route.ts  ← GET /api/invoices (list all)
│               │              ← POST /api/invoices (create new)
│               │
│               └── [id]/
│                   ├── route.ts      ← GET (single invoice)
│                   │                  ← PATCH (edit draft)
│                   │                  ← DELETE (delete draft)
│                   ├── send/
│                   │   └── route.ts  ← POST (draft → sent)
│                   ├── payments/
│                   │   └── route.ts  ← POST (record payment)
│                   │                  ← GET (list payments)
│                   └── void/
│                       └── route.ts  ← POST (→ void)
