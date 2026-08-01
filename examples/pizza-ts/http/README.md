# http/ — integration requests

Live HTTP requests against a running `pizza-ts` server. They are also the
integration tests: each request asserts the response, and each assertion maps
back to a QA Test Case in [`../specs/order.spec.md`](../specs/order.spec.md).

## Files

- `orders.http` — the request collection (`.http` format).
- `http-client.env.json` — environments (the IntelliJ HTTP Client format).

The **IntelliJ HTTP Client** and **httpyac** both read `http-client.env.json`
directly. The `{{host}}` variable therefore resolves in either tool from the
same JSON file, and you configure nothing else.

## Running

Start the server first (from `examples/pizza-ts`):

```bash
npm install
npm run start   # http://localhost:3000
```

### IntelliJ / WebStorm

Open `orders.http`, pick the `local` environment in the run gutter, and click
the ▶ next to any request (or "Run all requests in file").

### httpyac (CLI)

```bash
# from examples/pizza-ts
npm run http
# or target one file / environment:
npx httpyac send http/orders.http --all --env local
```

### httpyac (VS Code)

Install the **httpyac** extension, open `orders.http`, and use "Send All" /
"Send" code lenses. The `local` environment comes from `http-client.env.json`.

## Note on format

Only [`../specs/order.spec.md`](../specs/order.spec.md) follows the OKF/spec.md
format. These READMEs are plain developer documentation. The `.http` files are
too, but the test names in them use the same
[Simplified Technical English](../../../README.md#the-language) as the spec
rows they prove.
