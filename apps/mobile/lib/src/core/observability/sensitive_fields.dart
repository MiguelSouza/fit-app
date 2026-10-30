/// What never leaves this app about a person, masked by **field name**.
///
/// This is the Dart twin of `packages/observability/src/sensitive-fields.ts`,
/// and it is a copy on purpose: the app cannot import TypeScript, and the one
/// thing worse than two copies of a list is a list that only the API has. The
/// two files are the same rule and must change together — the names below are
/// in the same order as over there, so a diff between them is readable.
///
/// `CLAUDE.md` ("Saúde e LGPD") is blunt about it: no health data and no
/// personal data leaves, not in a log and not in an error report. Ids and
/// codes, yes. Matching errs on the side of masking: a `fileName` that comes
/// out as `[redacted]` costs an inconvenience, an e-mail address that comes
/// out in full is a breach.
library;

/// What a masked value is replaced by.
const String redacted = '[redacted]';

/// What is left where the walk stopped, deeper than [_maxDepth].
const String truncated = '[truncated]';

/// Deeper than this, a value is cut instead of walked. Also what stops a cycle.
const int _maxDepth = 8;

/// Field names masked whole. Normalized: lower case, without `_`, `-` or
/// spaces, so `check_in`, `checkIn` and `CHECK-IN` are the same name.
const Set<String> _sensitiveNames = <String>{
  // Who the person is
  'name',
  'email',
  'mail',
  'phone',
  'mobile',
  'whatsapp',
  // Where the professional wrote down how to reach somebody (card I-02)
  'contact',
  'contacts',
  'cpf',
  'birthdate',
  'dateofbirth',
  'dob',
  'address',
  // Credentials
  'token',
  'authorization',
  'cookie',
  'password',
  'secret',
  'apikey',
  // What the patient wrote or reported
  'notes',
  'note',
  'observations',
  'weight',
  'height',
  'bodyfat',
  'mood',
  'energy',
  'pain',
  'symptom',
  'symptoms',
  'measures',
  'measurements',
  'sleephours',
};

/// Suffixes, for the same fields with a qualifier in front: `patientName`,
/// `contactEmail`, `accessToken`, `professional_phone`, `patientContact`,
/// `lastCheckIn`.
const List<String> _sensitiveSuffixes = <String>[
  'name',
  'checkin',
  'email',
  'phone',
  'contact',
  'token',
  'secret',
  'password',
  'notes',
  'note',
  'cpf',
  'birthdate',
  'address',
  'apikey',
];

/// Prefixes, for a field named after what it belongs to: `checkInWeight`.
const List<String> _sensitivePrefixes = <String>['checkin'];

final RegExp _separators = RegExp('[^a-z0-9]');

String _normalize(String key) => key.toLowerCase().replaceAll(_separators, '');

/// Whether a field with this name is masked.
bool isSensitiveKey(String key) {
  final String name = _normalize(key);

  return _sensitiveNames.contains(name) ||
      _sensitiveSuffixes.any(name.endsWith) ||
      _sensitivePrefixes.any(name.startsWith);
}

/// A copy of [value] with every sensitive field replaced by [redacted], at any
/// depth and through lists. Pure: what it is given is not touched.
Object? redactSensitive(Object? value) => _walk(value, 0);

/// The same, for a map that is already the top level of something — the keys
/// of this one are checked too.
Map<String, dynamic> redactSensitiveMap(Map<String, dynamic> map) {
  final Map<String, dynamic> result = <String, dynamic>{};

  map.forEach((String key, dynamic value) {
    result[key] = isSensitiveKey(key) ? redacted : _walk(value, 1);
  });

  return result;
}

Object? _walk(Object? value, int depth) {
  if (value is Map) {
    if (depth >= _maxDepth) return truncated;

    final Map<String, dynamic> result = <String, dynamic>{};

    value.forEach((Object? key, Object? item) {
      final String name = '$key';
      result[name] = isSensitiveKey(name) ? redacted : _walk(item, depth + 1);
    });

    return result;
  }

  if (value is List) {
    if (depth >= _maxDepth) return truncated;

    return value.map((Object? item) => _walk(item, depth + 1)).toList();
  }

  // Anything else goes through as it is: a number, a string, a date, or an
  // object of the SDK that knows how to serialize itself. Walking into one of
  // those would turn it into a bag of fields and lose its `toJson`.
  return value;
}
