/// Which day the check-in on screen is about.
///
/// The API takes the day as `YYYY-MM-DD` and reads it in the **patient's own
/// time zone**, the one on their profile, and it only accepts today
/// (card P-02). So the app has one job here: say which day it is where the
/// phone is.
///
/// **The device's zone and the profile's can disagree**, and the app does not
/// pretend otherwise. Dart's core library converts an instant to the local zone
/// and to UTC, and to no other zone by name — reading `America/Sao_Paulo` on a
/// phone set to Lisbon needs the IANA database, which is a package and a
/// decision this card has no reason to make. What happens when the two
/// disagree is already decided and already safe: the API refuses with
/// `health.checkin.window_closed`, the screen shows that message, and no
/// check-in is written under the wrong day. Travelling across a border is the
/// case this costs, and the profile's zone is a screen of its own.

/// Today, as the API takes it, read where the phone is.
///
/// [now] is the instant to read, which a test passes and the app does not: the
/// device's clock answers otherwise.
String checkinDayOf([DateTime? now]) {
  final local = (now ?? DateTime.now()).toLocal();

  return '${_pad(local.year, 4)}-${_pad(local.month, 2)}-${_pad(local.day, 2)}';
}

/// `DD/MM` of a `YYYY-MM-DD`, for the line that tells the patient which day
/// they are answering.
///
/// Short on purpose, and built from the text instead of parsed into a
/// `DateTime`: a day is not an instant, and turning it into one to print two
/// numbers is how a Tuesday becomes a Monday. Anything that is not a day comes
/// back unchanged, which is a label nobody can be misled by.
String checkinDayLabel(String day) {
  final parts = day.split('-');

  if (parts.length != 3) return day;

  return '${parts[2]}/${parts[1]}';
}

String _pad(int value, int width) => value.toString().padLeft(width, '0');
