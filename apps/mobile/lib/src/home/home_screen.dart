import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_failure.dart';
import '../api/me.dart';
import '../auth/auth_providers.dart';
import '../core/theme/app_colors.dart';
import '../shared/environment_badge.dart';
import '../shared/screen_message.dart';
import '../shared/sentry_check_button.dart';

/// The home of the app, which only opens with a session (`router.dart`).
///
/// What it shows is `GET /v1/me` end to end, which is what card F-14 asks to
/// prove: the Supabase session becomes an `Authorization: Bearer` in the
/// generated client, the API validates the token and answers the contract, and
/// what it answered shows up here. No value on this screen is computed by the
/// app.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Início'),
        actions: <Widget>[
          const EnvironmentBadge(),
          const SizedBox(width: 8),

          // Renders nothing on a production build, like the badge above it.
          const SentryCheckButton(),
          IconButton(
            tooltip: 'Sair',
            icon: const Icon(Icons.logout),
            onPressed: () => signOut(ref.read(supabaseAuthProvider)),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => _refresh(ref),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              Text('Sua conta', style: textTheme.titleLarge),
              const SizedBox(height: 4),
              Text('O que a API responde em GET /v1/me.', style: textTheme.labelSmall),
              const SizedBox(height: 16),

              me.when(
                data: (data) => _Identity(me: data),
                error: (error, stackTrace) => _Failure(error: error),
                loading: () => const _Loading(),
              ),

              const SizedBox(height: 32),
              Text(
                'Seu plano alimentar, seus check-ins e seu diário aparecem aqui '
                'quando os cards dos módulos nutrition e health chegarem.',
                style: textTheme.labelSmall,
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Pull to refresh. The failure is swallowed here and nowhere else: the
  /// provider keeps it, and the screen below already shows it — letting it out
  /// of the `RefreshIndicator` would only reach the console.
  static Future<void> _refresh(WidgetRef ref) async {
    ref.invalidate(meProvider);

    try {
      await ref.read(meProvider.future);
    } on ApiFailure {
      return;
    }
  }
}

/// The three fields of `MeResponse`, typed by the contract.
///
/// The **name** is not among them, and that is not an oversight: `GET /v1/me`
/// answers id, role and time zone, and name and e-mail are personal data that
/// come with the profile endpoint of the `identity` module — the one that logs
/// the access (`packages/contracts/src/identity/me.ts`).
class _Identity extends StatelessWidget {
  const _Identity({required this.me});

  final MeResponse me;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _Field(label: 'Papel', value: _roleLabel(me.role)),
            const SizedBox(height: 12),
            _Field(label: 'Fuso horário', value: me.timeZone),
            const SizedBox(height: 12),
            _Field(label: 'Id da pessoa', value: me.personId, mono: true),
          ],
        ),
      ),
    );
  }
}

/// pt-BR for each value of the `PersonRole` of the contract. A role the
/// contract gains and nobody translates shows its code, which is visible and
/// harmless — never a crash on the patient's home screen.
String _roleLabel(PersonRole role) => switch (role) {
  PersonRole.professional => 'Profissional',
  PersonRole.patient => 'Paciente',
  _ => role.name,
};

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.value, this.mono = false});

  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label.toUpperCase(), style: textTheme.labelSmall),
        const SizedBox(height: 2),
        Text(
          value,
          style: mono
              ? textTheme.bodyMedium?.copyWith(fontFamily: 'monospace', fontSize: 13)
              : textTheme.bodyMedium,
        ),
      ],
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) => const Card(
    child: Padding(
      padding: EdgeInsets.all(24),
      child: Center(child: CircularProgressIndicator()),
    ),
  );
}

/// A call that did not work out, with the one move that makes sense for it.
///
/// A refused token is the session's problem, not the network's: the way out is
/// to sign in again, and signing out is what takes the person there — the
/// router watches the session, and there is no `push` in this file.
class _Failure extends ConsumerWidget {
  const _Failure({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final failure = error is ApiFailure
        ? error as ApiFailure
        : const ApiFailure(message: 'Algo não funcionou aqui. Tente novamente em instantes.');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        ScreenMessage(message: failure.message, tone: MessageTone.danger),
        const SizedBox(height: 12),
        if (failure.unauthorized)
          FilledButton(
            onPressed: () => signOut(ref.read(supabaseAuthProvider)),
            child: const Text('Entrar novamente'),
          )
        else
          TextButton(
            onPressed: () => ref.invalidate(meProvider),
            style: TextButton.styleFrom(foregroundColor: AppColors.primary),
            child: const Text('Tentar de novo'),
          ),
      ],
    );
  }
}
