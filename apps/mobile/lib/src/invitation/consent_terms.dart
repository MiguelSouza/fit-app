import 'package:fit_app_api_client/fit_app_api_client.dart';

/// What the patient is asked to consent to, one purpose at a time.
///
/// LGPD asks for consent **por finalidade**, so the onboarding is not one
/// "aceito os termos" but four answers, each with the text it was given
/// against — which is also what the API records, one row per purpose with the
/// version of the terms on it (ADR 0016).
///
/// The purposes themselves are the contract's (`ConsentType`, generated from
/// the OpenAPI document): the app does not invent a fifth, and a purpose the
/// API gains and nobody writes text for stops this file from compiling into a
/// complete list (`invitationConsentTerms` is checked against
/// `ConsentType.values` in the tests).

/// The version of the terms **this build shows**.
///
/// It is the Dart twin of `CURRENT_TERMS_VERSION`
/// (`apps/api/src/modules/identity/domain/consent.ts`), in the same way the
/// Sentry filter of this app is the twin of `@fit-app/observability`: the app
/// cannot import TypeScript, so the two copies move together.
///
/// What the app shows and what the API **records** are decided in two places
/// on purpose, and only one of them is authoritative: the API writes the
/// version it itself serves, never one a client sent, so a stale app can show
/// an old number but can never record agreement to a text nobody served
/// (ADR 0016). Until there is an endpoint that answers the current terms, this
/// constant moves with the API's.
const String currentTermsVersion = '1.0';

/// One purpose, as a screen asks for it: what it is called, what it is for,
/// the text being agreed to, and whether there is a follow-up without it.
class ConsentTerm {
  const ConsentTerm({
    required this.type,
    required this.title,
    required this.purpose,
    required this.terms,
    required this.isRequired,
  });

  /// The purpose, as the API names it. It is what travels in the acceptance.
  final ConsentType type;

  /// pt-BR, and short enough to be the title of the screen.
  final String title;

  /// One line: what the platform does with it, in the patient's words.
  final String purpose;

  /// The text being agreed to. It is shown whole, never behind a link: a term
  /// nobody read is not a consent.
  final String terms;

  /// Whether the acceptance fails without it.
  ///
  /// The two required ones are the API's (`REQUIRED_CONSENTS`), and the app
  /// only mirrors them so it can refuse to advance before the round trip — the
  /// refusal that counts is the 422 of the API, which holds for every client.
  final bool isRequired;
}

/// The four purposes, in the order the platform talks about them: what the
/// follow-up rests on first, then what is built on top of it.
const List<ConsentTerm> invitationConsentTerms = <ConsentTerm>[
  ConsentTerm(
    type: ConsentType.healthData,
    title: 'Seus dados de saúde',
    purpose: 'Para a fit-app guardar e organizar o que você registra.',
    terms:
        'Você autoriza a fit-app a guardar e tratar os dados de saúde que você registrar '
        'aqui: refeições, medidas, sono, sintomas, check-ins e o que mais o '
        'acompanhamento pedir.\n\n'
        'Esses dados ficam em servidores no Brasil e são usados para montar e acompanhar '
        'o seu plano. Eles não são vendidos e não são usados para publicidade.\n\n'
        'Sem este consentimento não há o que guardar, e por isso ele é obrigatório para '
        'usar o app. Você pode retirá-lo depois, nas suas permissões — e, quando retira '
        'este, as outras finalidades também são encerradas.',
    isRequired: true,
  ),
  ConsentTerm(
    type: ConsentType.shareWithProfessional,
    title: 'Compartilhar com seu nutricionista',
    purpose: 'Para quem acompanha você poder ver o que você registra.',
    terms:
        'Você autoriza a fit-app a mostrar os seus dados ao profissional da prática que '
        'enviou este convite, enquanto o acompanhamento estiver ativo.\n\n'
        'Toda vez que alguém abre a sua ficha, a fit-app registra quem abriu e quando, e '
        'você pode ver essa lista no app.\n\n'
        'Sem este consentimento o profissional não consegue ver nada, e o convite não faz '
        'sentido — por isso ele é obrigatório aqui. Você pode retirá-lo depois, ou '
        'encerrar o acompanhamento: o acesso é cortado na hora, e o seu histórico '
        'continua sendo seu.',
    isRequired: true,
  ),
  ConsentTerm(
    type: ConsentType.wearableData,
    title: 'Dados do seu relógio ou pulseira',
    purpose: 'Para o seu sono e os seus treinos entrarem sozinhos.',
    terms:
        'Você autoriza a fit-app a importar os dados do aparelho que você conectar — '
        'sono, atividades, frequência cardíaca e passos — por meio do serviço que faz '
        'essa ponte.\n\n'
        'Nada é importado antes de você conectar um aparelho, e desconectar interrompe a '
        'importação.\n\n'
        'É opcional: sem ela o acompanhamento funciona igual, com o que você registrar à '
        'mão. Você pode autorizar depois, nas suas permissões.',
    isRequired: false,
  ),
  ConsentTerm(
    type: ConsentType.aiProcessing,
    title: 'Apoio de inteligência artificial',
    purpose: 'Para ajudar o profissional a enxergar o que merece atenção.',
    terms:
        'Você autoriza a fit-app a usar os seus dados em recursos de inteligência '
        'artificial que resumem o período e apontam o que merece revisão do '
        'profissional.\n\n'
        'Os dados são anonimizados antes de serem enviados para o serviço de IA, e o que '
        'ele produz é uma sugestão para o profissional ler: nenhum texto gerado é '
        'diagnóstico, e nenhuma decisão sobre o seu acompanhamento é tomada por ele.\n\n'
        'É opcional: sem ela o profissional continua vendo tudo e decidindo tudo. Você '
        'pode autorizar depois, nas suas permissões.',
    isRequired: false,
  ),
];

/// The term of a purpose, for a screen that holds the purpose and needs the
/// words — the end of the onboarding, which says what is in force. `null` for
/// a purpose the API gained and this build has no text for, which a screen
/// skips instead of crashing on.
ConsentTerm? consentTermOf(ConsentType type) {
  for (final term in invitationConsentTerms) {
    if (term.type == type) return term;
  }

  return null;
}

/// The purposes the acceptance cannot go without, read off the list above.
///
/// It is what the flow checks before calling the API, and what a test compares
/// with the two the API requires.
List<ConsentType> get requiredConsentTypes => invitationConsentTerms
    .where((term) => term.isRequired)
    .map((term) => term.type)
    .toList(growable: false);
