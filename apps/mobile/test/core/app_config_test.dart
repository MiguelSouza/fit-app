import 'package:fit_app/src/core/config/app_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppConfig.from', () {
    test('trims what it is given', () {
      final config = AppConfig.from(
        environment: ' staging ',
        apiUrl: ' https://api.exemplo.com ',
        supabaseUrl: 'https://projeto.supabase.co',
        supabaseAnonKey: 'chave ',
      );

      expect(config.environment, AppEnvironment.staging);
      expect(config.apiUrl, 'https://api.exemplo.com');
      expect(config.supabaseAnonKey, 'chave');
    });

    test('names every missing define, and no value', () {
      Object? thrown;

      try {
        AppConfig.from(
          environment: 'local',
          apiUrl: '',
          supabaseUrl: '   ',
          supabaseAnonKey: 'chave-que-nao-pode-aparecer',
        );
      } on MissingConfigError catch (error) {
        thrown = error;
      }

      expect(thrown, isA<MissingConfigError>());
      expect((thrown! as MissingConfigError).missing, <String>['API_URL', 'SUPABASE_URL']);
      expect(thrown.toString(), contains('API_URL'));
      expect(thrown.toString(), contains('SUPABASE_URL'));
      expect(thrown.toString(), isNot(contains('chave-que-nao-pode-aparecer')));
    });
  });

  group('AppConfig.from, for the optional defines', () {
    test('a build with no Sentry define reports to nobody', () {
      final config = AppConfig.from(
        environment: 'local',
        apiUrl: 'http://127.0.0.1:3333',
        supabaseUrl: 'http://127.0.0.1:54321',
        supabaseAnonKey: 'chave',
      );

      expect(config.sentryDsn, isNull);
      expect(config.sentryRelease, isNull);
    });

    test('an empty define is a define nobody passed', () {
      final config = AppConfig.from(
        environment: 'staging',
        apiUrl: 'https://api.exemplo.com',
        supabaseUrl: 'https://projeto.supabase.co',
        supabaseAnonKey: 'chave',
        sentryDsn: '  ',
        sentryRelease: ' app@1.2.3 ',
      );

      expect(config.sentryDsn, isNull);
      expect(config.sentryRelease, 'app@1.2.3');
    });
  });

  group('AppConfig.parseEnvironment', () {
    test('reads the three names, in any case', () {
      expect(AppConfig.parseEnvironment('local'), AppEnvironment.local);
      expect(AppConfig.parseEnvironment('Staging'), AppEnvironment.staging);
      expect(AppConfig.parseEnvironment('PRODUCTION'), AppEnvironment.production);
    });

    test('falls back to local, never to production', () {
      expect(AppConfig.parseEnvironment(''), AppEnvironment.local);
      expect(AppConfig.parseEnvironment('prod'), AppEnvironment.local);
      expect(AppConfig.parseEnvironment('produção'), AppEnvironment.local);
    });

    test('only production is production', () {
      expect(AppEnvironment.production.isProduction, isTrue);
      expect(AppEnvironment.staging.isProduction, isFalse);
      expect(AppEnvironment.local.isProduction, isFalse);
    });
  });
}
