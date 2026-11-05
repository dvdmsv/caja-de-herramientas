// Generado por scripts/android/generar-patrones.py desde backend/api/patrones.py.
export const PATRONES = [
  {
    "tipo": "iban",
    "expresion": "(?<![0-9A-Za-z])[A-Z]{2}[ -]?\\d{2}(?:[ -]?[0-9A-Z]{4}){2,7}(?:[ -]?[0-9A-Z]{1,4})?(?![0-9A-Za-z])",
    "ignorarCaso": false
  },
  {
    "tipo": "tarjeta",
    "expresion": "(?<!\\d)\\d{4}(?:[ -]?\\d{4}){2,4}(?!\\d)",
    "ignorarCaso": false
  },
  {
    "tipo": "nie",
    "expresion": "(?<![0-9A-Za-z])[XYZ][ -]?\\d{7}[ -]?[A-Z](?![0-9A-Za-z])",
    "ignorarCaso": true
  },
  {
    "tipo": "dni",
    "expresion": "(?<![0-9A-Za-z])\\d{8}[ -]?[A-Z](?![0-9A-Za-z])",
    "ignorarCaso": true
  },
  {
    "tipo": "correo",
    "expresion": "(?<![0-9A-Za-z._%+-])[0-9A-Za-z._%+-]+@[0-9A-Za-z.-]+\\.[A-Za-z]{2,}(?![0-9A-Za-z.-])",
    "ignorarCaso": false
  },
  {
    "tipo": "cif",
    "expresion": "(?<![0-9A-Za-z])[ABCDEFGHJNPQRSUVW][ -]?\\d{7}[ -]?[0-9A-J](?![0-9A-Za-z])",
    "ignorarCaso": true
  },
  {
    "tipo": "matricula",
    "expresion": "(?<![0-9A-Za-z])(?:\\d{4}[ -]?[BCDFGHJKLMNPRSTVWXYZ]{3}|(?:VI|AB|A|AL|AV|BA|PM|IB|B|BU|CC|CA|CS|CE|CR|CO|C|CU|GI|GE|GR|GU|SS|H|HU|J|LE|L|LO|LU|M|MA|ML|MU|NA|OR|OU|O|P|PO|SA|TF|S|SG|SE|SO|T|GC|TE|TO|V|VA|ZA|Z)[ -]?\\d{4}[ -]?[A-Z]{1,2})(?![0-9A-Za-z])",
    "ignorarCaso": false
  },
  {
    "tipo": "telefono",
    "expresion": "(?<![\\d+])(?:\\+34[ -]?)?[6-9](?:[ -]?\\d){8}(?!\\d)",
    "ignorarCaso": false
  },
  {
    "tipo": "codigo_postal",
    "expresion": "(?<!\\d)(?:0[1-9]|[1-4]\\d|5[0-2])\\d{3}(?!\\d)",
    "ignorarCaso": false
  }
] as const;
