/// The invitation link and the invitation code, read without any I/O.
///
/// Pure, and tested on its own: this is the whole of "what the app accepts as
/// an invitation", and it has to hold for every shape a deep link arrives in
/// (see [isInvitationLink]).
///
/// What a token really is, is the API's answer: the row it matches is a hash
/// (ADR 0015), and nothing here says whether a link still works. What it does
/// is catch what cannot possibly be a token, so the person who pasted half a
/// message is told at once instead of after creating an account.
library;

/// The scheme the app answers to, and the host of the invitation link:
/// `fitapp://convite?token=<token>`.
///
/// The link the professional sends by WhatsApp points at the panel
/// (`/convite?token=...`, ADR 0015), and that page is the one that offers the
/// app. A custom scheme and not an App Link over the panel's own domain
/// because an App Link has to be verified by a file served from that domain,
/// which is infrastructure this card does not have — and a link that fails to
/// verify silently opens the browser instead of the app.
const String invitationLinkScheme = 'fitapp';

/// The host of the deep link, which is also the path of the screen inside the
/// app (`router.dart`). The two are the same word on purpose: what the engine
/// hands over is a uri whose **host** is this word and whose path is empty,
/// and what the router matches is the path `/convite`.
const String invitationLinkHost = 'convite';

/// The name of the query parameter the token travels in, the panel's own.
///
/// In the query string and not in the path, which is where ADR 0015 put it: a
/// token is a bearer credential, and the Sentry filter of this app keeps the
/// path of a url and throws the query away
/// (`core/observability/scrub_event.dart`).
const String invitationTokenParameter = 'token';

/// The bounds of the token, the contract's
/// (`packages/contracts/src/identity/invitation-acceptance.ts`): 43 characters
/// of `base64url` is what the API issues, and these are wide enough around it
/// that the API, and not this file, is what refuses an unusual one.
const int _tokenMinLength = 20;
const int _tokenMaxLength = 200;

/// Whether this uri is an invitation link, whatever shape it arrived in.
///
/// A deep link does not arrive as a route of this app, and this is the one
/// place that knows the shapes it does arrive in. Both platforms hand the
/// engine the whole address, so `fitapp://convite?token=abc` comes in with
/// `convite` as the **host** and no path at all — which matches no route until
/// it is normalised. Engines that predate that dropped the host and handed
/// over the path and the query (`/?token=abc`), and that shape is recognised
/// here too, as is the panel's own `https://<painel>/convite?token=abc` — the
/// day the link becomes an App Link over that domain, nothing below has to
/// change.
bool isInvitationLink(Uri uri) {
  if (uri.host == invitationLinkHost) return true;
  if (uri.pathSegments.isNotEmpty && uri.pathSegments.last == invitationLinkHost) return true;

  return uri.queryParameters.containsKey(invitationTokenParameter);
}

/// The token an invitation link carries, or `null` when it carries none.
///
/// It comes back **as it arrived**, even when it is not a plausible token: a
/// link with a broken token is not the same thing as a link with no token, and
/// the screen says so ("Link de convite inválido") instead of opening an empty
/// field and letting the person guess.
String? invitationTokenIn(Uri uri) {
  final token = uri.queryParameters[invitationTokenParameter]?.trim() ?? '';

  return token.isEmpty ? null : token;
}

/// The token out of what somebody typed or pasted into the field.
///
/// A patient who cannot open the link reads the code to themselves, and a
/// patient who can, pastes the whole message. Both end here: anything that
/// parses as an address with a `token` in it gives up its token, and anything
/// else is taken to be the code itself. `null` only for an empty field.
String? invitationTokenTyped(String typed) {
  final value = typed.trim();

  if (value.isEmpty) return null;

  final uri = Uri.tryParse(value);

  if (uri != null) {
    final inLink = invitationTokenIn(uri);

    if (inLink != null) return inLink;
  }

  return value;
}

/// Whether a token has a shape the API could possibly accept.
///
/// Length and no whitespace, and no character class: what makes a token valid
/// is matching a stored hash, and a pattern here would say more about the
/// format than the app has any business knowing (ADR 0015). It exists to catch
/// half a pasted message before an account is created for nothing.
bool looksLikeInvitationToken(String token) {
  final value = token.trim();

  if (value.length < _tokenMinLength || value.length > _tokenMaxLength) return false;

  return !value.contains(RegExp(r'\s'));
}
