# Um vídeo é um conjunto de quadros, apresentados em sequência. A velocidade dos quadros é medida em Frames Por Segundo (FPS). Cada frame é composto por uma matriz de pixels, onde cada pixel carrega 3 canais de cor: Vermelho, Verde e Azul (RGB, ou BGR no caso do OpenCV).
import cv2
import os
import math
from pathlib import Path
base_path = os.path.dirname(os.path.realpath(__file__))

output_path = base_path + "/data/output"
output_frame_dump_path = output_path + "/frame_dump"
def create_folders():
    Path(output_path).mkdir(parents=True, exist_ok=True)
    Path(output_frame_dump_path).mkdir(parents=True, exist_ok=True)

def get_capture():
    capture = cv2.VideoCapture(f'{base_path}/data/file_example_MP4_1280_10MG.mp4')
    capture_open = capture.isOpened()
    print("Video Carregado? ", capture_open)
    if not capture_open:
        exit(0)

    return capture

def skip_frames(frames: int,capture: cv2.VideoCapture): 
    while(frames > 0):
        capture.read()
        frames = frames - 1

def dump_frames(capture: cv2.VideoCapture):
    counter = 0
    while(True):
        frame = capture.read()

        if not frame[0]:
            break
        counter = counter + 1
        cv2.imwrite(f'{output_path}/frame_dump/frame_{counter}.png',frame[1])


create_folders();
capture = get_capture()


# https://docs.opencv.org/4.10.0/d4/d15/group__videoio__flags__base.html#gaeb8dd9c89c10a5c63c139bf7c4f5704d

capture_fps = capture.get(cv2.CAP_PROP_FPS)
capture_height = capture.get(cv2.CAP_PROP_FRAME_HEIGHT)
capture_width = capture.get(cv2.CAP_PROP_FRAME_WIDTH)
capture_frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT)

print("Framerate do vídeo: ", capture_fps)
print("Altura do video (px): ", capture_height)
print("Largura do vídeo (px): ", capture_width)
print("Total de Frames do vídeo: ", capture_frame_count)
print("Duração calculada do vídeo (total_frames/fps) ", capture_frame_count/capture_fps)


middle_frame_idx = math.floor(capture_frame_count/2)

print("# do frame intermediario: ", middle_frame_idx)

skip_frames(middle_frame_idx-1,capture)

middle_frame = capture.read()

capture.release()
print("Sucesso ao obter frame intermediario? ", middle_frame[0])

if not middle_frame[0]:
    exit(0)

#escreve o frame intermediario
cv2.imwrite(f'{output_path}/frame_meio_raw.png',middle_frame[1]);
#suavizar

frame_meio_suave_1 = cv2.GaussianBlur(middle_frame[1], (1,1), 0)
cv2.imwrite(f'{output_path}/frame_meio_suave_1.png',frame_meio_suave_1);

frame_meio_suave_7 = cv2.GaussianBlur(middle_frame[1], (7,7), 0)
cv2.imwrite(f'{output_path}/frame_meio_suave_7.png',frame_meio_suave_7);

frame_meio_cinza = cv2.cvtColor(middle_frame[1], cv2.COLOR_BGR2GRAY)
cv2.imwrite(f'{output_path}/frame_meio_cinza.png',frame_meio_cinza);

frame_bordas = cv2.Canny(frame_meio_cinza,threshold1=25,threshold2=25)
cv2.imwrite(f'{output_path}/frame_meio_bordas.png',frame_bordas);

capture = get_capture()
dump_frames(capture)
capture.release()