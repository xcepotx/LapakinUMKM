# Lapakin hardening smoke tests

Additional smoke tests for the Lapakin storefront hardening sprint.

## Run on dev

```bash
BASE_URL=https://dev.lapakin.my.id \
TEST_EMAIL=warungbusari@demo.lapakin.id \
TEST_PASSWORD=demo12345 \
STORE_SLUG=warung-bu-sari \
scripts/smoke/run_lapakin_hardening_smoke.sh
```

These tests intentionally run after the existing smoke tests and add coverage for:

- product categories
- product availability/status fields
- storefront map/testimonial/contact sections
- WhatsApp checkout and product inquiry templates
- payment instruction/QRIS settings
- lead capture and lead inbox payload
- legacy and template renderer storefront paths
- storefront analytics event endpoint
