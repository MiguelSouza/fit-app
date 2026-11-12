import 'package:dio/dio.dart';
import 'package:fit_app_api_client/fit_app_api_client.dart';

import '../api/api_failure.dart';

/// `POST /v1/invitations/accept`: the patient joins the practice that invited
/// them (card P-01, ADR 0016).
///
/// It is the first call of this app made with a session that was created one
/// screen earlier: the API reads who is accepting from the `sub` of the
/// verified token and never from this body (ADR 0007), so nothing here says
/// who the patient is.
///
/// The time zone is **not** sent. The device knows its offset and not its IANA
/// name, and a wrong zone is what dates a night of sleep wrongly, so the
/// absent field lets the API apply the platform's default — which the patient
/// changes later, on a screen that has the list.
///
/// Nothing is logged: the token is a credential, the name is personal data,
/// and so is the list of purposes somebody ticked (CLAUDE.md, "Saúde e LGPD").
Future<AcceptedInvitation> acceptInvitation(
  FitAppApiClient api, {
  required String token,
  required String fullName,
  required List<ConsentType> consents,
}) async {
  try {
    final response = await api.getInvitationsApi().invitationsControllerAcceptV1(
      acceptInvitationRequest: AcceptInvitationRequest(
        (request) => request
          ..token = token
          ..fullName = fullName
          ..consents.replace(consents),
      ),
    );

    final accepted = response.data;

    if (accepted == null) {
      throw const ApiFailure(
        message: 'A API respondeu sem corpo em POST /v1/invitations/accept.',
      );
    }

    return accepted;
  } on DioException catch (error) {
    // Rethrown as the failure a screen knows how to read. The `DioException`
    // stops here: it carries the request, and the body of this one is the
    // token of the link.
    throw apiFailure(error);
  }
}
