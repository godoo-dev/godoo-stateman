# godoo-stateman

Terraform for Odoo — declarative Odoo state reconciliation over jsonrpc.

godoo-stateman reconciles Odoo instance state remotely over JSON-RPC. It evaluates a Python DSL describing desired Odoo state, diffs it against live Odoo, and executes a plan of creates/updates/deletes/archives in dependency order.

## Installation

```bash
pip install godoo-stateman
```

## Usage

```bash
godoo-stateman --help
```

## License

LGPL-3.0-or-later
