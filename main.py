import numpy as np
import matplotlib
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from matplotlib.widgets import Slider, Button, RadioButtons

matplotlib.use('QtAgg')

# ==========================================
# 1. БАЗА ДАННЫХ МАТЕРИАЛОВ
# ==========================================
MATERIALS = {
    'Водяной лёд': {
        'rho': 917.0, 'cp': 2090.0, 'k_solid': 2.22, 'k_liquid': 0.58,
        'L': 334000.0, 'Tm': 0.0, 'dT': 0.5
    },
    'Парафин': {
        'rho': 900.0, 'cp': 2100.0, 'k_solid': 0.24, 'k_liquid': 0.15,
        'L': 200000.0, 'Tm': 54.0, 'dT': 1.0
    },
    'Галлий': {
        'rho': 5910.0, 'cp': 370.0, 'k_solid': 32.0, 'k_liquid': 29.0,
        'L': 80000.0, 'Tm': 29.76, 'dT': 0.2
    }
}

LX, LY = 0.1, 0.1  
NX, NY = 60, 60  
dx, dy = LX / NX, LY / NY
x = np.linspace(0, LX, NX)
y = np.linspace(0, LY, NY)
X, Y = np.meshgrid(x, y, indexing='ij')

SOURCE_CONFIGS = list([(0.02, 0.02, 1.0)])  
SOURCE_SIGMA = 0.005

mat = dict(MATERIALS['Водяной лёд'])
T_ambient = 2.0
T_object_init = -5.0

OBJECT_CENTER = (0.06, 0.06)
OBJECT_SIZE = 0.03
OBJECT_SHAPE = 'Квадрат'

dt = 0.015  
# Ускоряет интерфейс
steps_per_frame = 3000  

H = np.zeros((NX, NY))
T = np.zeros((NX, NY))
Q = np.zeros((NX, NY))
ice_mask = np.zeros((NX, NY), dtype=bool)
obstacle_mask = np.zeros((NX, NY), dtype=int)  
obstacle_rgba = np.zeros((NX, NY, 4))          

initial_ice_mass = 1.0
time_history = list()
mass_history = list()
is_mouse_pressed = False

# ==========================================
# 2. МАТЕМАТИЧЕСКОЕ ЯДРО
# ==========================================
def update_critical_enthalpies():
    global H_solid_max, H_liquid_min
    H_solid_max = mat['cp'] * (mat['Tm'] - mat['dT'])
    H_liquid_min = mat['cp'] * (mat['Tm'] + mat['dT']) + mat['L']

def T_from_H(H_field):
    T_field = np.zeros_like(H_field)
    mask_solid = H_field < H_solid_max
    T_field[mask_solid] = H_field[mask_solid] / mat['cp']
    mask_liquid = H_field > H_liquid_min
    T_field[mask_liquid] = (H_field[mask_liquid] - mat['L']) / mat['cp']
    mask_mush = ~(mask_solid | mask_liquid)
    denom = mat['cp'] + mat['L'] / (2.0 * mat['dT'])
    num = H_field[mask_mush] + mat['L'] * (mat['Tm'] - mat['dT']) / (2.0 * mat['dT'])
    T_field[mask_mush] = num / denom
    return T_field

def get_liquid_fraction(T_field):
    fl = (T_field - (mat['Tm'] - mat['dT'])) / (2.0 * mat['dT'])
    return np.clip(fl, 0.0, 1.0)

def calculate_sources(base_power):
    global Q
    Q.fill(0.0)
    for src_x, src_y, weight in SOURCE_CONFIGS:
        Q += weight * base_power * np.exp(-((X - src_x)**2 + (Y - src_y)**2) / (2.0 * SOURCE_SIGMA**2))

def build_geometry():
    global ice_mask
    if OBJECT_SHAPE == 'Квадрат':
        base_mask = (np.abs(X - OBJECT_CENTER[0]) <= OBJECT_SIZE / 2) & \
                    (np.abs(Y - OBJECT_CENTER[1]) <= OBJECT_SIZE / 2)
    else:
        base_mask = ((X - OBJECT_CENTER[0])**2 + (Y - OBJECT_CENTER[1])**2) <= (OBJECT_SIZE / 2)**2
    ice_mask = base_mask & (obstacle_mask == 0)

def update_obstacle_plot():
    obstacle_rgba.fill(0.0)
    obstacle_rgba[obstacle_mask == 1] = [0.55, 0.27, 0.07, 0.85] 
    obstacle_rgba[obstacle_mask == 2] = [0.0, 0.75, 1.0, 0.85]   
    im_obs.set_array(np.transpose(obstacle_rgba, (1, 0, 2)))

def reinit_simulation():
    global H, T, initial_ice_mass, time_history, mass_history, contour_holder
    update_critical_enthalpies()
    calculate_sources(slider_power.val)
    build_geometry()
    
    T.fill(mat['Tm'] + T_ambient)
    T[ice_mask] = mat['Tm'] + T_object_init
    T[obstacle_mask == 2] = mat['Tm'] - 5.0
    
    fl_init = get_liquid_fraction(T)
    H = mat['cp'] * T + mat['L'] * fl_init
    
    initial_ice_mass = np.sum((1.0 - fl_init)[ice_mask]) * mat['rho'] * dx * dy
    if initial_ice_mass <= 0: initial_ice_mass = 1.0
    
    time_history.clear()
    mass_history.clear()
    
    if contour_holder is not None:
        contour_holder.remove()
        contour_holder = None
        
    ax2.set_xlim(0, 45)
    mass_line.set_data(np.array(list()), np.array(list()))
    update_source_markers()
    update_obstacle_plot()

def harmonic_mean(k1, k2):
    return 2.0 * k1 * k2 / (k1 + k2 + 1e-15)

def find_optimal_position():
    """ 
    Волновой алгоритм (поиск пути). Строит карту "тепловой дальности".
    Чем больше препятствий между точкой и источником тепла, тем она безопаснее.
    """
    if len(SOURCE_CONFIGS) == 0 and not np.any(obstacle_mask == 2):
        return OBJECT_CENTER 
        
    thermal_dist = np.full((NX, NY), 10000.0)
    for sx, sy, w in SOURCE_CONFIGS:
        i = int(np.clip(sx/dx, 0, NX-1))
        j = int(np.clip(sy/dy, 0, NY-1))
        thermal_dist[i, j] = 0.0
        
    cost = np.ones((NX, NY))
    cost[obstacle_mask == 1] = 500.0
    cost[obstacle_mask == 2] = 2.0
    
    for _ in range(150):
        N1 = np.pad(thermal_dist[:-1, :], ((1, 0), (0, 0)), constant_values=10000.0)
        N2 = np.pad(thermal_dist[1:, :], ((0, 1), (0, 0)), constant_values=10000.0)
        N3 = np.pad(thermal_dist[:, :-1], ((0, 0), (1, 0)), constant_values=10000.0)
        N4 = np.pad(thermal_dist[:, 1:], ((0, 0), (0, 1)), constant_values=10000.0)
        min_neighbors = np.minimum(np.minimum(N1, N2), np.minimum(N3, N4))
        thermal_dist = np.minimum(thermal_dist, min_neighbors + cost)
        
    cool_dist = np.full((NX, NY), 10000.0)
    if np.any(obstacle_mask == 2):
        cool_dist[obstacle_mask == 2] = 0.0
        for _ in range(150):
            N1 = np.pad(cool_dist[:-1, :], ((1, 0), (0, 0)), constant_values=10000.0)
            N2 = np.pad(cool_dist[1:, :], ((0, 1), (0, 0)), constant_values=10000.0)
            N3 = np.pad(cool_dist[:, :-1], ((0, 0), (1, 0)), constant_values=10000.0)
            N4 = np.pad(cool_dist[:, 1:], ((0, 0), (0, 1)), constant_values=10000.0)
            min_neighbors = np.minimum(np.minimum(N1, N2), np.minimum(N3, N4))
            cool_dist = np.minimum(cool_dist, min_neighbors + cost)
            
    safety_score = thermal_dist - 2.0 * cool_dist
    
    margin = int((OBJECT_SIZE / 2) / dx) + 1
    best_score = -float('inf')
    best_coords = OBJECT_CENTER
    
    for i in range(margin, NX - margin):
        for j in range(margin, NY - margin):
            cx, cy = x[i], y[j]
            
            if OBJECT_SHAPE == 'Квадрат':
                cand_mask = (np.abs(X - cx) <= OBJECT_SIZE / 2) & (np.abs(Y - cy) <= OBJECT_SIZE / 2)
            else:
                cand_mask = ((X - cx)**2 + (Y - cy)**2) <= (OBJECT_SIZE / 2)**2
                
            if np.any(obstacle_mask[cand_mask] == 1):
                continue
                
            current_score = np.mean(safety_score[cand_mask])
            if current_score > best_score:
                best_score = current_score
                best_coords = (cx, cy)
                
    return best_coords

# ==========================================
# 3. ГРАФИКА И ИНТЕРФЕЙС
# ==========================================
fig = plt.figure(figsize=(15, 8))
fig.suptitle("Физический симулятор-песочница с умным оптимизатором", fontsize=15)

ax1 = fig.add_axes(np.array([0.05, 0.35, 0.4, 0.55]))
ax2 = fig.add_axes(np.array([0.53, 0.35, 0.4, 0.55]))

im = ax1.imshow(T.T, extent=[0, LX, 0, LY], origin='lower', cmap='coolwarm')
cb = fig.colorbar(im, ax=ax1, label="Температура (°C)")
im_obs = ax1.imshow(np.transpose(obstacle_rgba, (1, 0, 2)), extent=[0, LX, 0, LY], origin='lower')
source_plot, = ax1.plot(np.array(list()), np.array(list()), 'ko', markerfacecolor='yellow', markersize=8, markeredgewidth=1.5, label='Источники')
ax1.set_title("Тепловое поле (Зажмите мышь для рисования)")
ax1.legend(loc='upper right')

mass_line, = ax2.plot(np.array(list()), np.array(list()), 'b-', lw=2)
ax2.set_ylim(-5, 105)
ax2.set_xlabel("Время (сек)")
ax2.set_ylabel("Оставшаяся масса объекта (%)")
ax2.grid(True)

contour_holder = None

def update_source_markers():
    if len(SOURCE_CONFIGS) > 0:
        source_plot.set_data(np.array([s[0] for s in SOURCE_CONFIGS]), np.array([s[1] for s in SOURCE_CONFIGS]))
    else:
        source_plot.set_data(np.array(list()), np.array(list()))

def update_physics(frame):
    global H, contour_holder
    if len(time_history) > 0 and mass_history[-1] <= 0.01:
        return im, mass_line, source_plot
        
    for _ in range(steps_per_frame):
        T_current = T_from_H(H)
        fl_current = get_liquid_fraction(T_current)
        fl_current[obstacle_mask > 0] = 0.0 
        
        k = mat['k_solid'] + (mat['k_liquid'] - mat['k_solid']) * fl_current
        k[obstacle_mask == 1] = 1e-6 
        k[obstacle_mask == 2] = mat['k_solid'] 
        
        k_R = harmonic_mean(k[1:-1, 1:-1], k[2:, 1:-1])
        k_L = harmonic_mean(k[1:-1, 1:-1], k[:-2, 1:-1])
        k_U = harmonic_mean(k[1:-1, 1:-1], k[1:-1, 2:])
        k_D = harmonic_mean(k[1:-1, 1:-1], k[1:-1, :-2])
        
        flux_x_R = k_R * (T_current[2:, 1:-1] - T_current[1:-1, 1:-1]) / dx**2
        flux_x_L = k_L * (T_current[1:-1, 1:-1] - T_current[:-2, 1:-1]) / dx**2
        flux_y_U = k_U * (T_current[1:-1, 2:] - T_current[1:-1, 1:-1]) / dy**2
        flux_y_D = k_D * (T_current[1:-1, 1:-1] - T_current[1:-1, :-2]) / dy**2
        
        Q_active = Q[1:-1, 1:-1].copy()
        mask_cool = (obstacle_mask[1:-1, 1:-1] == 2) & (T_current[1:-1, 1:-1] > -15.0)
        Q_active[mask_cool] -= slider_power.val * 0.25 
        
        H[1:-1, 1:-1] += (dt / mat['rho']) * (flux_x_R - flux_x_L + flux_y_U - flux_y_D + Q_active)
        
        H[0, :] = H[1, :]
        H[-1, :] = H[-2, :]
        H[:, 0] = H[:, 1]
        H[:, -1] = H[:, -2]

    T_final = T_from_H(H)
    fl_final = get_liquid_fraction(T_final)
    
    current_time = frame * dt * steps_per_frame
    current_ice_mass = np.sum((1.0 - fl_final)[ice_mask]) * mat['rho'] * dx * dy
    mass_percentage = (current_ice_mass / initial_ice_mass) * 100.0 if initial_ice_mass > 0 else 0
    
    time_history.append(current_time)
    mass_history.append(mass_percentage)
    
    im.set_array(T_final.T)
    im.set_clim(vmin=mat['Tm'] + T_object_init - 2, vmax=mat['Tm'] + T_ambient + 10)
    
    if contour_holder is not None:
        contour_holder.remove()
        contour_holder = None
        
    if np.min(T_final) < mat['Tm'] < np.max(T_final):
        contour_holder = ax1.contour(X, Y, T_final, levels=[mat['Tm']], colors='white', linewidths=1.5)
        
    mass_line.set_data(np.array(time_history), np.array(mass_history))
    if current_time > ax2.get_xlim()[1]:
        ax2.set_xlim(0, current_time * 1.2)
        
    return im, mass_line, source_plot

# ==========================================
# 4. ПАНЕЛЬ УПРАВЛЕНИЯ
# ==========================================
ax_slider_power = fig.add_axes(np.array([0.08, 0.22, 0.25, 0.025]))
ax_slider_temp  = fig.add_axes(np.array([0.08, 0.15, 0.25, 0.025]))
ax_slider_size  = fig.add_axes(np.array([0.08, 0.08, 0.25, 0.025]))

ax_radio_mat   = fig.add_axes(np.array([0.38, 0.05, 0.12, 0.20]))
ax_radio_shape = fig.add_axes(np.array([0.52, 0.17, 0.12, 0.08]))
ax_radio_tool  = fig.add_axes(np.array([0.52, 0.03, 0.20, 0.12]))

ax_btn_clear   = fig.add_axes(np.array([0.76, 0.19, 0.18, 0.045]))
ax_btn_opt     = fig.add_axes(np.array([0.76, 0.12, 0.18, 0.045]))
ax_btn_reset   = fig.add_axes(np.array([0.76, 0.05, 0.18, 0.055]))

slider_power = Slider(ax_slider_power, 'Мощность', 1e7, 2e8, valinit=8e7, valfmt='%1.1e Вт')
slider_temp  = Slider(ax_slider_temp, 'dT Среды', 0.5, 10.0, valinit=3.0, valfmt='%1.1f °C')
slider_size  = Slider(ax_slider_size, 'Размер', 0.01, 0.08, valinit=0.03, valfmt='%1.3f м')

radio_mat   = RadioButtons(ax_radio_mat, np.array(list(MATERIALS.keys())))
radio_shape = RadioButtons(ax_radio_shape, np.array(['Квадрат', 'Круг']))
radio_tool  = RadioButtons(ax_radio_tool, np.array([
    '♨️ Источники тепла', 
    '🧊 Двигать объект', 
    '🧱 Рисовать Изолятор', 
    '❄️ Рисовать Охладитель', 
    '🧹 Стереть препятствия'
]))

btn_clear = Button(ax_btn_clear, 'Очистить сцену', color='lightcoral')
btn_opt   = Button(ax_btn_opt, '🤖 Найти оптимум', color='khaki')
btn_reset = Button(ax_btn_reset, 'ПЕРЕЗАПУСК', color='lightgreen')

def on_mat_change(label): global mat; mat = dict(MATERIALS[label]); reinit_simulation()
def on_shape_change(label): global OBJECT_SHAPE; OBJECT_SHAPE = label; reinit_simulation()
def on_sliders_change(val):
    global T_ambient, OBJECT_SIZE
    T_ambient = slider_temp.val
    OBJECT_SIZE = slider_size.val
    calculate_sources(slider_power.val)
    if val == slider_size.val: reinit_simulation()

def on_clear_clicked(event):
    SOURCE_CONFIGS.clear()
    obstacle_mask.fill(0)
    calculate_sources(slider_power.val)
    reinit_simulation()

def on_opt_clicked(event):
    global OBJECT_CENTER
    OBJECT_CENTER = find_optimal_position()
    reinit_simulation()

def on_reset_clicked(event): reinit_simulation()

def handle_mouse_drawing(event):
    if event.inaxes != ax1 or event.xdata is None or event.ydata is None: return
    tool = radio_tool.value_selected
    
    i = int(event.xdata / dx)
    j = int(event.ydata / dy)
    
    if 0 <= i < NX and 0 <= j < NY:
        changed = False
        if 'Изолятор' in tool and obstacle_mask[i, j] != 1: 
            obstacle_mask[i, j] = 1; changed = True
        elif 'Охладитель' in tool and obstacle_mask[i, j] != 2: 
            obstacle_mask[i, j] = 2; changed = True
        elif 'Стереть' in tool and obstacle_mask[i, j] != 0: 
            obstacle_mask[i, j] = 0; changed = True
            
        if changed:
            update_obstacle_plot()

def on_mouse_press(event):
    global is_mouse_pressed, OBJECT_CENTER
    if event.inaxes != ax1 or event.xdata is None or event.ydata is None: return
    is_mouse_pressed = True
    
    tool = radio_tool.value_selected
    if tool == '♨️ Источники тепла':
        SOURCE_CONFIGS.append((event.xdata, event.ydata, 1.0))
        calculate_sources(slider_power.val)
        update_source_markers()
    elif tool == '🧊 Двигать объект':
        OBJECT_CENTER = (event.xdata, event.ydata)
        reinit_simulation()
    else:
        handle_mouse_drawing(event)

def on_mouse_move(event):
    if is_mouse_pressed: handle_mouse_drawing(event)

def on_mouse_release(event):
    global is_mouse_pressed
    is_mouse_pressed = False

radio_mat.on_clicked(on_mat_change)
radio_shape.on_clicked(on_shape_change)
slider_power.on_changed(on_sliders_change)
slider_temp.on_changed(on_sliders_change)
slider_size.on_changed(on_sliders_change)
btn_clear.on_clicked(on_clear_clicked)
btn_opt.on_clicked(on_opt_clicked)
btn_reset.on_clicked(on_reset_clicked)

fig.canvas.mpl_connect('button_press_event', on_mouse_press)
fig.canvas.mpl_connect('motion_notify_event', on_mouse_move)
fig.canvas.mpl_connect('button_release_event', on_mouse_release)

reinit_simulation()
ani = animation.FuncAnimation(fig, update_physics, frames=500, interval=30, blit=False)
plt.show()