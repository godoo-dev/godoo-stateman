# godoo-stateman

**Terraform for Odoo** — declarative, idempotent Odoo state reconciliation over JSON-RPC.

godoo-stateman evaluates a Python DSL describing desired Odoo state, diffs it against
a live Odoo instance, and executes a plan of creates/updates/deletes/archives in
dependency order — without an agent, addon, or sidecar state file.

## Installation

```bash
pip install godoo-stateman
```

## Quick Start

See the [README](https://github.com/marcfargas/godoo-stateman) for usage examples.

## Requirements

- Python 3.14+
- Odoo 17+ (Community Edition)
- Network access to Odoo JSON-RPC endpoint
