import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_failure.dart';
import '../core/theme/app_colors.dart';
import '../shared/screen_message.dart';
import 'checkin_api.dart';
import 'checkin_day.dart';
import 'checkin_labels.dart';
import 'checkin_scale_field.dart';
import 'checkin_symptom_chips.dart';

/// The check-in of the day: ten seconds, in one screen (card P-02).
///
/// **The whole screen is built around the acceptance criterion "completar o
/// check-in leva menos de 15 segundos".** Three scales of five taps each, the
/// symptoms as chips nobody has to touch, and the note last and optional: a day
/// with nothing to report is **four taps** — energy, sleep, hunger, save — with
/// no scrolling required to reach the button on a phone, and no keyboard
/// anywhere on the path. Nothing on this screen asks the patient to type to
/// finish.
///
/// **It opens on what is already there.** The day's check-in is fetched while
/// the form is on screen, and it is folded in only if the patient has not
/// touched anything yet — somebody who opened the screen and started tapping
/// is never overwritten by an answer arriving from the network. That is what
/// makes "editável no mesmo dia" a screen and not a second feature: the same
/// form, prefilled, and the same button.
///
/// **No rule is decided here.** Which day may be written, what the day is in
/// the patient's zone, how the symptoms are normalized and whether a detail of
/// `other` is kept are the API's answers, inside the use case; the refusal that
/// counts is its 422, which holds for every client. What the screen refuses on
/// its own — a save before the three scales are answered — it refuses to spare
/// the round trip, never to replace it.
///
/// **Nothing of this is logged**, not a value, not a symptom and not the note
/// (`CLAUDE.md`, "Saúde e LGPD"). The only text that reaches the screen from
/// outside is the `message` of the API's error envelope, which the contract
/// guarantees in pt-BR and free of patient data.
class CheckinScreen extends ConsumerStatefulWidget {
  const CheckinScreen({super.key});

  @override
  ConsumerState<CheckinScreen> createState() => _CheckinScreenState();
}

class _CheckinScreenState extends ConsumerState<CheckinScreen> {
  /// The day this screen is about: today, where the phone is
  /// (`checkin_day.dart`). Read once, so the form cannot change day under the
  /// person filling it in.
  final String _day = checkinDayOf();

  final _otherSymptom = TextEditingController();
  final _note = TextEditingController();

  int? _energy;
  int? _sleepQuality;
  int? _hunger;

  final Set<CheckinSymptom> _symptoms = <CheckinSymptom>{};

  /// Whether the patient has answered anything on this screen.
  ///
  /// It is what keeps the check-in arriving from the network from landing on
  /// top of somebody's taps: the form is usable the instant it is drawn, and
  /// the answer of `GET /v1/me/checkins` is only folded in while nothing has
  /// been touched.
  bool _touched = false;

  /// Whether the day's check-in has already been read, however it came back.
  bool _loaded = false;

  bool _saving = false;

  /// What the API said when it refused, already in pt-BR. `null` when nothing
  /// has.
  String? _failure;

  /// The check-in as the API answered it, once it did. It is what turns the
  /// screen into "salvo, e dá para corrigir".
  Checkin? _saved;

  @override
  void dispose() {
    _otherSymptom.dispose();
    _note.dispose();
    super.dispose();
  }

  /// The day's check-in, as the starting point of the form.
  void _seedFrom(Checkin? checkin) {
    _loaded = true;

    if (checkin == null || _touched) return;

    _energy = checkin.energy;
    _sleepQuality = checkin.sleepQuality;
    _hunger = checkin.hunger;

    _symptoms
      ..clear()
      ..addAll(checkin.symptoms);

    _otherSymptom.text = checkin.otherSymptom ?? '';
    _note.text = checkin.note ?? '';
    _saved = checkin;
  }

  void _answer(void Function() change) {
    setState(() {
      _touched = true;
      _failure = null;
      change();
    });
  }

  /// Whether there is a check-in to send: the three scales. Everything else is
  /// optional, which is the difference between a check-in and a form.
  bool get _complete => _energy != null && _sleepQuality != null && _hunger != null;

  /// `PUT /v1/me/checkins/{date}`: the one request of this screen.
  ///
  /// Idempotent by the shape of the endpoint — the day is the address — so a
  /// double tap and a retry save one check-in.
  Future<void> _save() async {
    final energy = _energy;
    final sleepQuality = _sleepQuality;
    final hunger = _hunger;

    if (energy == null || sleepQuality == null || hunger == null) return;

    setState(() {
      _saving = true;
      _failure = null;
    });

    try {
      final saved = await ref.read(saveCheckinProvider)(
        day: _day,
        answers: RecordCheckinRequest(
          (request) => request
            ..energy = energy
            ..sleepQuality = sleepQuality
            ..hunger = hunger
            ..symptoms.replace(_symptoms)
            ..otherSymptom = _textOrNull(_otherSymptom)
            ..note = _textOrNull(_note),
        ),
      );

      if (!mounted) return;

      setState(() => _saved = saved);
    } on ApiFailure catch (failure) {
      if (!mounted) return;

      setState(() => _failure = failure.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = ref.watch(todayCheckinProvider);

    // Folded in during the build the answer itself triggered, which is why
    // there is no `setState` here and no listener: the fields are seeded and
    // the very same build renders them. `_seedFrom` is what decides whether
    // the answer may touch anything at all — somebody who has started tapping
    // is never overwritten.
    //
    // A day that could not be read is not a day that cannot be written: the
    // form stays usable and empty, and the API is the one that decides whether
    // the save goes through.
    if (!_loaded) {
      today.when<void>(
        data: (checkin) {
          _seedFrom(checkin);
        },
        error: (error, stackTrace) {
          _loaded = true;
        },
        loading: () {},
      );
    }

    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Check-in de hoje')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Text('Como foi o seu dia?', style: textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(
              'Três toques e pronto. ${checkinDayLabel(_day)}.',
              style: textTheme.labelSmall,
            ),
            const SizedBox(height: 24),

            if (_failure != null) ...<Widget>[
              ScreenMessage(message: _failure!, tone: MessageTone.danger),
              const SizedBox(height: 16),
            ],

            if (_saved != null && _failure == null) ...<Widget>[
              const ScreenMessage(
                message: 'Check-in salvo. Você pode corrigir até o fim do dia.',
              ),
              const SizedBox(height: 16),
            ],

            CheckinScaleField(
              labels: energyLabels,
              value: _energy,
              onChanged: (value) => _answer(() => _energy = value),
            ),
            const SizedBox(height: 20),

            CheckinScaleField(
              labels: sleepQualityLabels,
              value: _sleepQuality,
              onChanged: (value) => _answer(() => _sleepQuality = value),
            ),
            const SizedBox(height: 20),

            CheckinScaleField(
              labels: hungerLabels,
              value: _hunger,
              onChanged: (value) => _answer(() => _hunger = value),
            ),
            const SizedBox(height: 28),

            Text('Sentiu algo hoje?', style: textTheme.bodyMedium),
            const SizedBox(height: 4),
            Text('Opcional. Sem nada marcado quer dizer "nada a relatar".',
                style: textTheme.labelSmall),
            const SizedBox(height: 12),

            CheckinSymptomChips(
              chosen: _symptoms,
              onToggled: (symptom) => _answer(() {
                if (!_symptoms.remove(symptom)) _symptoms.add(symptom);
              }),
            ),

            // Only next to the chip it details: the API drops a detail sent
            // without `other`, and a field with nowhere to land would be a
            // field that quietly loses what somebody typed.
            if (_symptoms.contains(CheckinSymptom.other)) ...<Widget>[
              const SizedBox(height: 16),
              TextField(
                controller: _otherSymptom,
                decoration: const InputDecoration(
                  labelText: 'O que foi?',
                  helperText: 'Em poucas palavras.',
                ),
                maxLength: checkinOtherSymptomMaxLength,
                textInputAction: TextInputAction.done,
                enabled: !_saving,
                onChanged: (_) => _answer(() {}),
              ),
            ],

            const SizedBox(height: 20),

            TextField(
              controller: _note,
              decoration: const InputDecoration(
                labelText: 'Quer contar mais alguma coisa?',
                helperText: 'Opcional. Só quem acompanha você lê.',
              ),
              minLines: 2,
              maxLines: 4,
              maxLength: checkinNoteMaxLength,
              keyboardType: TextInputType.multiline,
              enabled: !_saving,
              onChanged: (_) => _answer(() {}),
            ),
            const SizedBox(height: 16),

            FilledButton(
              onPressed: _complete && !_saving ? _save : null,
              child: Text(_buttonLabel()),
            ),
            const SizedBox(height: 8),

            Text(
              _complete
                  ? 'Você pode voltar e corrigir este check-in até o fim do dia.'
                  : 'Responda as três escalas para salvar.',
              textAlign: TextAlign.center,
              style: textTheme.labelSmall?.copyWith(color: AppColors.foregroundMuted),
            ),

            // Said once and only while nothing has been read: the form is
            // already usable, so this is a note and never a spinner in the way.
            if (!_loaded) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                'Procurando o check-in de hoje…',
                textAlign: TextAlign.center,
                style: textTheme.labelSmall,
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _buttonLabel() {
    if (_saving) return 'Salvando…';

    return _saved == null ? 'Salvar check-in' : 'Salvar correção';
  }
}

/// What the patient typed, or nothing at all: blank and absent are the same
/// answer, and the API reads them the same way.
String? _textOrNull(TextEditingController controller) {
  final text = controller.text.trim();

  return text.isEmpty ? null : text;
}
