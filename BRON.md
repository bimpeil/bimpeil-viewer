# Broncode van de viewer in BIMpeil

Deze repo bevat de broncode van de viewer die [BIMpeil](https://bimpeil.nl) levert: [IfcLite](https://github.com/LTplus-AG/ifc-lite) van LTplus AG met de aanpassingen van BIMpeil. IfcLite en de aanpassingen vallen onder de Mozilla Public License 2.0 (zie LICENSE).

| Branch of tag | Wat |
| --- | --- |
| `bimpeil` | IfcLite met de aanpassingen van BIMpeil |
| `main` | IfcLite zonder wijzigingen |
| `viewer-<commit>` | Een versie die BIMpeil gebruikt |

De aanpassingen van BIMpeil staan in `apps/viewer/src/bimpeil/` en zijn in bestanden van IfcLite gemarkeerd met `BIMpeil:`; de lijst staat in `BIMPEIL.md`.

De map `.github` van IfcLite hoort bij hun eigen ontwikkeling: de workflows draaien hier niet, en `dependabot.yml` staat niet op `bimpeil`. Bijdragen en issues horen bij [IfcLite](https://github.com/LTplus-AG/ifc-lite); deze repo neemt geen pull requests aan.

---

Source code of the viewer in BIMpeil: IfcLite by LTplus AG with BIMpeil's changes, under the Mozilla Public License 2.0. Branch `bimpeil` holds the changes, `main` is unchanged IfcLite, and each version used by BIMpeil has a tag `viewer-<commit>`.
