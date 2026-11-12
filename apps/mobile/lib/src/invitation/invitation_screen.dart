import 'dart:async';

import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/api_client.dart';
import '../api/api_failure.dart';
import '../app/router.dart';
import '../auth/auth_providers.dart';
import '../core/theme/app_colors.dart';
import '../shared/environment_badge.dart';
import '../shared/screen_message.dart';
import 'accept_invitation.dart';
import 'consent_page.dart';
import 'consent_terms.dart';
import 'invitation_link.dart';

/// The onboarding of a patient by invitation, end to end (card P-01).
///
/// Four steps, one screen: the code of the link, the account in Supabase Auth,
/// one consent screen per purpose, and the answer of the API — "você está
/// conectado a ...". It is the one route that answers with **and** without a
/// session (`router.dart`): the person arrives with no account and is signed
/// in halfway through, and the flow must not be thrown out from under them.
///
/// No rule is decided here. Whether the link still works, whether the required
/// consents are there and whether this account may become a patient are the
/// API's answers, inside the use case (ADR 0016); what the screen refuses on
/// its own — an impossible code, a form half filled in — it refuses to spare
/// the round trip, never to replace it.
///
/// Nothing of this flow is logged: not the token, not the name, not which
/// purposes were ticked (CLAUDE.md, "Saúde e LGPD"). The only text that
/// reaches the screen from outside is the `message` of the API's error
/// envelope, which the contract guarantees in pt-BR and free of patient data.
class InvitationScreen extends ConsumerStatefulWidget {
  const InvitationScreen({this.token, super.key});

  /// The token the link carried, or `null` when the app was opened by hand and
  /// the code is going to be typed.
  final String? token;

  @override
  ConsumerState<InvitationScreen> createState() => _InvitationScreenState();
}

/// Where the patient is in the flow.
enum _Step { code, account, consents, done }

class _InvitationScreenState extends ConsumerState<InvitationScreen> {
  final _codeKey = GlobalKey<FormState>();
  final _accountKey = GlobalKey<FormState>();

  final _code = TextEditingController();
  final _fullName = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();

  _Step _step = _Step.code;

  /// The token of the link, once it is plausible. The API is what says whether
  /// it is good.
  String? _token;

  /// Whether the account step is signing in instead of signing up — the
  /// patient of a second practice already has an account (ADR 0016).
  bool _hasAccount = false;

  int _consentIndex = 0;

  /// The purposes ticked so far, in the order of the screens.
  final List<ConsentType> _consents = <ConsentType>[];

  bool _submitting = false;

  /// What to put on the screen when something refused: already in pt-BR, from
  /// the API when it answered and from here when it did not.
  String? _failure;

  /// The acceptance, once the API answered it.
  AcceptedInvitation? _accepted;

  @override
  void initState() {
    super.initState();
    _readLink(widget.token);
  }

  @override
  void didUpdateWidget(InvitationScreen oldWidget) {
    super.didUpdateWidget(oldWidget);

    // A second link, opened while this screen was up. It is adopted only
    // before the account exists: a link arriving in the middle of the consents
    // must not silently change which practice is being joined.
    if (widget.token != oldWidget.token && _step == _Step.code) {
      setState(() => _readLink(widget.token));
    }
  }

  /// The token of the link, checked for shape and nothing else.
  ///
  /// It assigns, and does not notify: it runs from `initState`, where there is
  /// nothing to rebuild yet, and from `didUpdateWidget`, which wraps it.
  void _readLink(String? token) {
    if (token == null) return;

    _code.text = token;

    // A link whose token could not possibly be one: the field opens with it in
    // place and the message above it, so the person can fix a code they typed
    // by hand instead of being sent back to a blank screen.
    if (!looksLikeInvitationToken(token)) {
      _failure = _invalidCode;

      return;
    }

    _token = token;
    _failure = null;
    _step = _Step.account;
  }

  @override
  void dispose() {
    _code.dispose();
    _fullName.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submitCode() {
    if (!(_codeKey.currentState?.validate() ?? false)) return;

    final typed = invitationTokenTyped(_code.text);

    setState(() {
      _token = typed;
      _failure = null;
      _step = _Step.account;
    });
  }

  /// Creates the account, or signs in to the one the patient already has, and
  /// moves on to the consents. The session is what the acceptance travels
  /// with, so there is nothing to do here until Auth answers.
  Future<void> _submitAccount() async {
    if (!(_accountKey.currentState?.validate() ?? false)) return;

    setState(() {
      _submitting = true;
      _failure = null;
    });

    final auth = ref.read(supabaseAuthProvider);
    final email = _email.text.trim();

    try {
      if (_hasAccount) {
        final signedIn = await signIn(auth, email: email, password: _password.text);

        if (!mounted) return;

        setState(() {
          // One message for any refusal, like the 401 of the API and like the
          // sign in screen: a reason would say who has an account here.
          if (signedIn) {
            _step = _Step.consents;
          } else {
            _failure = 'E-mail ou senha incorretos.';
          }
        });

        return;
      }

      final outcome = await signUp(auth, email: email, password: _password.text);

      if (!mounted) return;

      // A refusal says nothing about why, for the same reason the sign in does
      // not. The one outcome with something to say is the confirmation: there
      // is an account and no session, so the acceptance cannot be made yet.
      final refusal = switch (outcome) {
        SignUpOutcome.signedIn => null,
        SignUpOutcome.confirmationNeeded =>
          'Enviamos um e-mail para você confirmar seu endereço. Confirme e abra o link '
              'do convite de novo para terminar.',
        SignUpOutcome.refused =>
          'Não foi possível criar sua conta com esses dados. Confira o e-mail e a senha '
              'e tente de novo.',
      };

      setState(() {
        _failure = refusal;

        if (outcome == SignUpOutcome.signedIn) _step = _Step.consents;
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// The answer to one purpose, and the next screen — or the acceptance, after
  /// the last one.
  void _answerConsent(ConsentType type, {required bool accepted}) {
    _consents.remove(type);

    if (accepted) _consents.add(type);

    if (_consentIndex + 1 < invitationConsentTerms.length) {
      setState(() => _consentIndex += 1);

      return;
    }

    unawaited(_accept());
  }

  /// `POST /v1/invitations/accept`: the one request of this flow.
  Future<void> _accept() async {
    final token = _token;

    if (token == null) return;

    setState(() {
      _submitting = true;
      _failure = null;
    });

    try {
      final accepted = await acceptInvitation(
        ref.read(apiClientProvider),
        token: token,
        fullName: _fullName.text.trim(),
        consents: _consents,
      );

      if (!mounted) return;

      setState(() {
        _accepted = accepted;
        _step = _Step.done;
      });
    } on ApiFailure catch (failure) {
      if (!mounted) return;

      setState(() => _failure = failure.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// Back to the field, with the consents forgotten: another code is another
  /// invitation, and the purposes are asked again against their own text.
  void _startOver() {
    setState(() {
      _token = null;
      _consents.clear();
      _consentIndex = 0;
      _failure = null;
      _step = _Step.code;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  const Align(alignment: Alignment.centerLeft, child: EnvironmentBadge()),
                  const SizedBox(height: 24),
                  _body(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _body() => switch (_step) {
    _Step.code => _codeStep(),
    _Step.account => _accountStep(),
    _Step.consents => _consentStep(),
    _Step.done => _doneStep(),
  };

  /// The failure of the moment, or nothing. One box, in one place, so no step
  /// writes its own.
  Widget _message() {
    final failure = _failure;

    if (failure == null) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: ScreenMessage(message: failure, tone: MessageTone.danger),
    );
  }

  Widget _codeStep() {
    final textTheme = Theme.of(context).textTheme;

    return Form(
      key: _codeKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text('Você foi convidado', style: textTheme.displaySmall),
          const SizedBox(height: 8),
          Text(
            'Abra o link que seu nutricionista enviou, ou cole aqui o código do convite.',
            style: textTheme.bodyMedium?.copyWith(color: AppColors.foregroundMuted),
          ),
          const SizedBox(height: 32),

          _message(),

          TextFormField(
            controller: _code,
            decoration: const InputDecoration(labelText: 'Código do convite'),
            autocorrect: false,
            enableSuggestions: false,
            textInputAction: TextInputAction.done,
            validator: _validateCode,
            onFieldSubmitted: (_) => _submitCode(),
          ),
          const SizedBox(height: 24),

          FilledButton(onPressed: _submitCode, child: const Text('Continuar')),
          const SizedBox(height: 8),

          TextButton(
            onPressed: () => context.go(signInPath),
            style: TextButton.styleFrom(foregroundColor: AppColors.foregroundMuted),
            child: const Text('Já uso a fit-app. Entrar'),
          ),
        ],
      ),
    );
  }

  Widget _accountStep() {
    final textTheme = Theme.of(context).textTheme;

    return Form(
      key: _accountKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            _hasAccount ? 'Entrar na sua conta' : 'Criar sua conta',
            style: textTheme.titleLarge,
          ),
          const SizedBox(height: 4),
          Text(
            _hasAccount
                ? 'Entre com a conta que você já usa na fit-app para aceitar este convite.'
                : 'É com ela que você entra no app e vê o seu acompanhamento.',
            style: textTheme.bodyMedium?.copyWith(color: AppColors.foregroundMuted),
          ),
          const SizedBox(height: 24),

          _message(),

          TextFormField(
            controller: _fullName,
            decoration: const InputDecoration(labelText: 'Nome completo'),
            textCapitalization: TextCapitalization.words,
            textInputAction: TextInputAction.next,
            autofillHints: const <String>[AutofillHints.name],
            enabled: !_submitting,
            validator: _validateFullName,
          ),
          const SizedBox(height: 16),

          TextFormField(
            controller: _email,
            decoration: const InputDecoration(labelText: 'E-mail'),
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.next,
            autocorrect: false,
            autofillHints: const <String>[AutofillHints.email],
            enabled: !_submitting,
            validator: _validateEmail,
          ),
          const SizedBox(height: 16),

          TextFormField(
            controller: _password,
            decoration: InputDecoration(
              labelText: 'Senha',
              helperText: _hasAccount ? null : 'Pelo menos 8 caracteres.',
            ),
            obscureText: true,
            textInputAction: TextInputAction.done,
            autofillHints: <String>[
              _hasAccount ? AutofillHints.password : AutofillHints.newPassword,
            ],
            enabled: !_submitting,
            validator: _hasAccount ? _validatePassword : _validateNewPassword,
            onFieldSubmitted: (_) => _submitting ? null : _submitAccount(),
          ),
          const SizedBox(height: 24),

          FilledButton(
            onPressed: _submitting ? null : _submitAccount,
            child: Text(_accountButtonLabel()),
          ),
          const SizedBox(height: 8),

          TextButton(
            onPressed: _submitting
                ? null
                : () => setState(() {
                    _hasAccount = !_hasAccount;
                    _failure = null;
                  }),
            style: TextButton.styleFrom(foregroundColor: AppColors.primary),
            child: Text(_hasAccount ? 'Não tenho conta ainda' : 'Já tenho uma conta'),
          ),

          TextButton(
            onPressed: _submitting ? null : _startOver,
            style: TextButton.styleFrom(foregroundColor: AppColors.foregroundMuted),
            child: const Text('Usar outro código'),
          ),
        ],
      ),
    );
  }

  String _accountButtonLabel() {
    if (_submitting) return _hasAccount ? 'Entrando…' : 'Criando…';

    return _hasAccount ? 'Entrar e continuar' : 'Criar conta e continuar';
  }

  Widget _consentStep() {
    // The acceptance is on its way, or it came back refused. Either way the
    // last answer is given and there is no purpose on screen to answer.
    if (_submitting) return const _Working(message: 'Conectando você ao seu nutricionista…');

    if (_failure != null) return _acceptFailed();

    final term = invitationConsentTerms[_consentIndex];

    return ConsentPage(
      // One state per purpose: the tick of one screen is not the tick of the
      // next, and a purpose answered before keeps its answer on the way back.
      key: ValueKey<ConsentType>(term.type),
      term: term,
      step: _consentIndex + 1,
      total: invitationConsentTerms.length,
      initiallyAccepted: _consents.contains(term.type),
      onAnswered: (accepted) => _answerConsent(term.type, accepted: accepted),
      onBack: _consentIndex == 0 ? null : () => setState(() => _consentIndex -= 1),
    );
  }

  /// The acceptance refused: the API's own message, and the two ways out.
  ///
  /// A link that was used, revoked or expired, and an account that is a
  /// professional's, all answer here (ADR 0016) — each with a message the
  /// contract wrote in pt-BR. The app does not translate the code into a
  /// screen of its own: a message it invented would be a second opinion about
  /// a rule it does not own.
  Widget _acceptFailed() {
    final textTheme = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text('Não deu para aceitar o convite', style: textTheme.titleLarge),
        const SizedBox(height: 16),

        _message(),

        FilledButton(onPressed: _accept, child: const Text('Tentar de novo')),
        const SizedBox(height: 8),

        TextButton(
          onPressed: _startOver,
          style: TextButton.styleFrom(foregroundColor: AppColors.primary),
          child: const Text('Usar outro código'),
        ),
      ],
    );
  }

  /// The end: who the patient is now with, and what they authorised.
  Widget _doneStep() {
    final accepted = _accepted;
    final textTheme = Theme.of(context).textTheme;

    if (accepted == null) return const _Working(message: 'Um instante…');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const Icon(Icons.check_circle_outline, color: AppColors.primary, size: 48),
        const SizedBox(height: 16),

        // The name of the practice, as the API answered it. For a solo
        // professional it is their own name (ADR 0014).
        Text(
          'Você está conectado a ${accepted.organizationName}',
          textAlign: TextAlign.center,
          style: textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Text(
          'A partir de agora seus registros aparecem para quem acompanha você.',
          textAlign: TextAlign.center,
          style: textTheme.bodyMedium?.copyWith(color: AppColors.foregroundMuted),
        ),
        const SizedBox(height: 24),

        _GrantedConsents(granted: accepted.consents),
        const SizedBox(height: 24),

        FilledButton(
          onPressed: () => context.go(homePath),
          child: const Text('Começar'),
        ),
      ],
    );
  }
}

/// What the patient authorised, in the words of the terms they read.
///
/// It is read off the API's answer and not off what the screen collected: a
/// patient accepting a second invitation already had purposes in force, and
/// what is true is what the API says is in force (ADR 0016).
class _GrantedConsents extends StatelessWidget {
  const _GrantedConsents({required this.granted});

  final Iterable<ConsentType> granted;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    final titles = granted
        .map(consentTermOf)
        .nonNulls
        .map((term) => term.title)
        .toList(growable: false);

    if (titles.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('VOCÊ AUTORIZOU', style: textTheme.labelSmall),
          const SizedBox(height: 8),
          for (final title in titles)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text('• $title', style: textTheme.bodyMedium),
            ),
          const SizedBox(height: 8),
          Text(
            'Você pode rever e retirar cada permissão depois, nas suas permissões.',
            style: textTheme.labelSmall,
          ),
        ],
      ),
    );
  }
}

/// A step that is waiting on the network.
class _Working extends StatelessWidget {
  const _Working({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        const CircularProgressIndicator(),
        const SizedBox(height: 16),
        Text(
          message,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      ],
    );
  }
}

/// What a code that cannot be a token is answered with. One text for a typo
/// and for a truncated link: both are "confira o código", and the app has no
/// way to tell them apart.
const String _invalidCode =
    'Link de convite inválido. Confira o código ou peça um novo ao seu nutricionista.';

String? _validateCode(String? value) {
  final typed = invitationTokenTyped(value ?? '');

  if (typed == null) return 'Informe o código do convite.';

  return looksLikeInvitationToken(typed) ? null : _invalidCode;
}

/// Two characters, the same bound the contract has: what a name is, is the
/// person's own business.
String? _validateFullName(String? value) =>
    (value ?? '').trim().length < 2 ? 'Informe seu nome completo.' : null;

/// Enough to catch a typo before the round trip, and no more — the same check
/// the sign in screen makes.
String? _validateEmail(String? value) {
  final email = value?.trim() ?? '';

  if (email.isEmpty) return 'Informe seu e-mail.';
  if (!email.contains('@') || email.endsWith('@')) return 'Informe um e-mail válido.';

  return null;
}

String? _validatePassword(String? value) => (value ?? '').isEmpty ? 'Informe sua senha.' : null;

/// A new password, which is the one case where the app may ask for more than
/// "not empty": a refusal from Auth over a short password would come back
/// without a reason, like every other refusal, and the person would have
/// nothing to fix.
String? _validateNewPassword(String? value) {
  final password = value ?? '';

  if (password.isEmpty) return 'Crie uma senha.';

  return password.length < 8 ? 'Use uma senha com pelo menos 8 caracteres.' : null;
}
