import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/theme/app_colors.dart';
import '../shared/environment_badge.dart';
import '../shared/screen_message.dart';
import 'auth_providers.dart';

/// Signing in with e-mail and password.
///
/// There is no navigation in here. Signing in creates the session, the session
/// notifies the router, and the redirect of `router.dart` takes the person
/// home — one place decides what a session may open.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _submitting = false;
  bool _failed = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _submitting = true;
      _failed = false;
    });

    final signedIn = await signIn(
      ref.read(supabaseAuthProvider),
      email: _email.text.trim(),
      password: _password.text,
    );

    if (!mounted) return;

    setState(() {
      _submitting = false;
      // One message for any refusal, like the 401 of the API: saying "this
      // e-mail does not exist" would hand over the list of who has an account
      // here. The reason never leaves `signIn`.
      _failed = !signedIn;
    });
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const Align(alignment: Alignment.centerLeft, child: EnvironmentBadge()),
                    const SizedBox(height: 24),
                    Text('fit-app', style: textTheme.displaySmall),
                    const SizedBox(height: 8),
                    Text(
                      'Entre com o e-mail e a senha que você usa na plataforma.',
                      style: textTheme.bodyMedium?.copyWith(color: AppColors.foregroundMuted),
                    ),
                    const SizedBox(height: 32),

                    if (_failed) ...<Widget>[
                      const ScreenMessage(
                        message: 'E-mail ou senha incorretos.',
                        tone: MessageTone.danger,
                      ),
                      const SizedBox(height: 16),
                    ],

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
                      decoration: const InputDecoration(labelText: 'Senha'),
                      obscureText: true,
                      textInputAction: TextInputAction.done,
                      autofillHints: const <String>[AutofillHints.password],
                      enabled: !_submitting,
                      validator: _validatePassword,
                      onFieldSubmitted: (_) => _submitting ? null : _submit(),
                    ),
                    const SizedBox(height: 24),

                    FilledButton(
                      onPressed: _submitting ? null : _submit,
                      child: Text(_submitting ? 'Entrando…' : 'Entrar'),
                    ),
                    const SizedBox(height: 16),

                    Text(
                      'Esqueceu a senha? Peça um novo acesso ao seu nutricionista.',
                      textAlign: TextAlign.center,
                      style: textTheme.labelSmall,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Enough to catch a typo before the round trip, and no more: what an address
/// really is, is the Auth server's answer.
String? _validateEmail(String? value) {
  final email = value?.trim() ?? '';

  if (email.isEmpty) return 'Informe seu e-mail.';
  if (!email.contains('@') || email.endsWith('@')) return 'Informe um e-mail válido.';

  return null;
}

String? _validatePassword(String? value) => (value ?? '').isEmpty ? 'Informe sua senha.' : null;
